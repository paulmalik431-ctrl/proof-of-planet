import { describe, expect, test } from "bun:test";
import { handle, type Inbound } from "../supabase/functions/_core/agent.ts";
import { MemoryStore } from "../supabase/functions/_core/store.ts";
import { supply, SYSTEM, verifyChain } from "../supabase/functions/_core/ledger.ts";
import { bestMatch, gradeLot, MATERIALS, sameCode } from "../supabase/functions/_core/loop.ts";
import { checkCode, hashCode, normalisePhone } from "../supabase/functions/_core/glance.ts";
import { dHash } from "../supabase/functions/_core/phash.ts";
import { runTool } from "../supabase/functions/_core/tools.ts";
import { fakeMeta, png, type Turn } from "./fake-meta.ts";

const T = (name: string, args: Record<string, unknown> = {}): Turn => ({ tools: [[name, args]] });
const say = (text: string): Turn => ({ text });

let n = 0;
const at = new Date("2026-10-28T09:00:00Z");
const FARMER = "254700000001", BRIQUETTES = "254700000002", SHOP = "254700000003", REVIEWER = "254700000009";
const m = (from: string, x: Partial<Inbound>): Inbound => ({ id: `m${++n}`, from, at, kind: "text", ...x });

const LOT = { identified_as: "rice_husk", matches_claim: "yes", condition_good: "yes", code_seen: "", estimated_quantity: 500, possibly_ai_generated_or_edited: false, confidence: 0.9, notes: "About ten sacks of dry rice husk; code visible on paper." };

function world(agent: Array<Turn | (() => Turn)>, opts: { codeInPhoto?: boolean; mediation?: Record<string, unknown>; lotPatch?: Record<string, unknown> } = {}) {
  const store = new MemoryStore(() => at);
  const lot = () => ({ ...LOT, ...opts.lotPatch, code_seen: opts.codeInPhoto === false ? "" : `code ${store.listings.at(-1)?.challenge ?? ""}` });
  const { meta, log } = fakeMeta({ sam: { sack: 10 }, observation: {}, json: { lot_observation: lot, ...(opts.mediation ? { mediation: opts.mediation } : {}) }, agent });
  const deps = { store, meta, publicUrl: "https://eco.example", limits: { messagesPerDay: 100, verificationsPerDay: 10 } };
  const id = async (phone: string) => (await store.accountByPhone(phone))!.id;
  return { store, deps, log, id };
}

/** A farmer lists 500 kg of rice husk; a briquette maker bids 4 ECOIN/kg. */
async function listAndBid(w: ReturnType<typeof world>) {
  const { deps } = w;
  for (const p of [FARMER, BRIQUETTES]) await handle(deps, m(p, { text: "yes" }));
  await handle(deps, m(FARMER, { text: "Nina kilo 500 za maganda ya mchele (rice husk)" }));
  await handle(deps, m(FARMER, { kind: "image", image: { bytes: png(3), mime: "image/jpeg" } }));
  await handle(deps, m(FARMER, { kind: "location", location: { lat: -0.69, lng: 37.36 } }));
  await handle(deps, m(BRIQUETTES, { text: "We make briquettes, company name Mwea Briquettes" }));
  await handle(deps, m(BRIQUETTES, { text: "test ECOIN please" }));
  await handle(deps, m(BRIQUETTES, { kind: "location", location: { lat: -0.70, lng: 37.38 } }));
  await handle(deps, m(BRIQUETTES, { text: "We buy rice husk, 1000 kg, up to 4 ECOIN per kg" }));
}

const listAndBidTurns = (): Turn[] => [
  T("sell_waste", { material: "rice_husk", quantity: 500 }), say("Write the code on paper and send a photo."),
  say("Now the pickup location."),
  T("publish_listing"), say("Listed, grade A."),
  T("register_business", { name: "Mwea Briquettes" }), say("Registered."),
  T("top_up_test_ecoin"), say("5,000 test ECOIN added."),
  say("Location saved."),
  T("buy_waste", { material: "rice_husk", quantity: 1000, max_price: 4 }), say("Found an offer."),
];

describe("Waste-to-value: rice husk to a briquette maker, then a shop", () => {
  test("bid sets the price; the weighed intake sets what is paid; fees feed the Reserve; ECOIN is spent at a shop", async () => {
    let w!: ReturnType<typeof world>;
    const tid = () => w.store.trades[0].id.slice(0, 6);
    w = world([
      ...listAndBidTurns(),
      () => T("accept_offer", { trade_id: tid() }), say("Paid into escrow."),
      say("Got the delivery photo."),
      () => T("mark_delivered", { trade_id: tid() }), say("Buyer notified."),
      () => T("confirm_delivery", { trade_id: tid(), accepted_quantity: 450, grade: "A" }), say("Recorded 450 kg."),
      T("register_shop", { name: "Mama Mboga" }), say("Shop registered."),
      T("charge_customer", { phone: `+${FARMER}`, amount: 150 }), say("Code sent; ask the customer."),
    ]);
    const { store, deps, id } = w;
    await listAndBid(w);

    const listing = store.listings[0];
    expect(listing).toMatchObject({ material: "rice_husk", status: "reserved", grade: "A", quantity: 500, sam_count: 10, unit: "kg" });
    expect(listing.challenge).toMatch(/^[A-Z2-9]{4}$/);
    expect(store.trades[0]).toMatchObject({ status: "proposed", price: 4, total: 2000 }); // the buyer's bid, never a model's price

    await handle(deps, m(BRIQUETTES, { text: `accept ${tid()}` }));
    expect(await store.balance(SYSTEM.escrow)).toBe(2000);
    expect(store.trades[0].intake_code_hash).toBeTruthy();

    await handle(deps, m(FARMER, { kind: "image", image: { bytes: png(7), mime: "image/jpeg" } }));
    await handle(deps, m(FARMER, { text: `delivered ${tid()}` }));
    expect(store.trades[0].status).toBe("delivered");

    await handle(deps, m(BRIQUETTES, { text: `confirm ${tid()} 450 kg` }));
    const t = store.trades[0];
    expect(t.status).toBe("released");
    expect(t.intake).toMatchObject({ accepted_quantity: 450, grade: "A", via: "whatsapp" });
    // 450 kg × 4 = 1800 to the seller side; 3% fees = 54 (Reserve 16, treasury 38); 200 back to the buyer.
    expect(await store.balance(await id(FARMER))).toBe(1746);
    expect(await store.balance(await id(BRIQUETTES))).toBe(3200);
    expect(await store.balance(SYSTEM.reserve)).toBe(16);
    expect(await store.balance(SYSTEM.treasury)).toBe(38);
    expect(await store.balance(SYSTEM.escrow)).toBe(0);

    await handle(deps, m(SHOP, { text: "yes" }));
    await handle(deps, m(SHOP, { text: "I run a shop called Mama Mboga" }));
    await handle(deps, m(SHOP, { text: `charge ${FARMER} 150` }));
    const sms = (await store.drain(await id(FARMER))).join();
    const code = /Your Glance code: \*(\d{6})\*/.exec(sms)![1];
    expect(store.payments[0].code_hash).not.toContain(code);
    expect((await handle(deps, m(SHOP, { text: "000000" })))[0]).toContain("Wrong code");
    expect((await handle(deps, m(SHOP, { text: code })))[0]).toContain("Paid: 150");
    expect(await store.balance(await id(FARMER))).toBe(1596);
    expect(await store.balance(await id(SHOP))).toBe(149);

    expect((await verifyChain(store.ledger)).ok).toBe(true);
    expect(supply(store.ledger)).toMatchObject({ minted: 0, deposits: 5000, balanced: true });
  });

  test("a photo without the one-time code is not listed", async () => {
    const w = world([T("sell_waste", { material: "rice_husk", quantity: 500 }), say("photo?"), say("location?"), T("publish_listing"), say("Need the code in the photo.")], { codeInPhoto: false });
    await handle(w.deps, m(FARMER, { text: "yes" }));
    await handle(w.deps, m(FARMER, { text: "rice husk 500kg" }));
    await handle(w.deps, m(FARMER, { kind: "image", image: { bytes: png(5), mime: "image/jpeg" } }));
    await handle(w.deps, m(FARMER, { kind: "location", location: { lat: 0, lng: 0 } }));
    expect(w.store.listings[0].status).toBe("draft");
    expect(w.store.listings[0].assessment?.reasons.join(" ")).toContain(w.store.listings[0].challenge!);
  });

  test("a wrong-material rejection cancels the draft and requires a fresh challenge", async () => {
    const w = world([], { lotPatch: { identified_as: "sawdust", matches_claim: "no", confidence: 0.95, notes: "Sawdust in sacks." } });
    const account = await w.store.createAccount(FARMER);
    const photo_path = await w.store.savePhoto(png(21), "image/png");
    const listing = await w.store.createListing({
      seller: account.id, material: "rice_husk", quantity: 500, unit: "kg", price: 0,
      grade: null, sam_count: 0, challenge: "ABCD", photo_path, photo_sha256: "wrong-material-test",
      lat: 0, lng: 0, status: "draft", assessment: null,
    });
    const session = {
      account_id: account.id, history: [], open_claim_id: null, open_listing_id: listing.id,
      last_location: { lat: 0, lng: 0 }, day: "2026-10-28", messages_today: 0, verifications_today: 0,
    };
    const result = await runTool({ deps: w.deps, account, session, now: at }, "publish_listing", {});

    expect(result).toMatchObject({
      outcome: "rejected",
      next: "This draft was cancelled. If the seller wants to try again, start sell_waste to create a new draft and challenge code before asking for another photo.",
    });
    expect(w.store.listings[0].status).toBe("cancelled");
    expect(session.open_listing_id).toBeNull();
    expect(w.store.trades).toHaveLength(0);
  });
  test("Loop cancels a listing whose photo is a near duplicate of a prior claim", async () => {
    const w = world([T("sell_waste", { material: "rice_husk", quantity: 500 }), say("photo?"), say("location?"), T("publish_listing"), say("duplicate rejected")]);
    const gray = Uint8Array.from({ length: 64 * 64 }, (_, i) => Math.round(128 + 40 * Math.sin((i % 64) / 9) + 25 * Math.cos(Math.floor(i / 64) / 11)));
    const phash = dHash(gray, 64, 64);
    w.deps.decodeImage = () => ({ gray, width: 64, height: 64 });
    const oldAccount = await w.store.createAccount("254700000008");
    const oldClaim = await w.store.createClaim({ account_id: oldAccount.id, protocol: "tree_planting", parent_id: null });
    await w.store.addEvidence({ claim_id: oldClaim.id, account_id: oldAccount.id, kind: "photo", role: "planting", path: "prior.jpg", sha256: "old-sha", phash, lat: null, lng: null, text: null });
    await handle(w.deps, m(FARMER, { text: "yes" }));
    await handle(w.deps, m(FARMER, { text: "rice husk 500 kg" }));
    await handle(w.deps, m(FARMER, { kind: "image", image: { bytes: png(12), mime: "image/png" } }));
    await handle(w.deps, m(FARMER, { kind: "location", location: { lat: 0, lng: 0 } }));
    await handle(w.deps, m(FARMER, { text: "publish listing" }));
    expect(w.store.listings[0].status).toBe("cancelled");
    expect(w.store.listings[0].assessment).toBeNull();
    expect(w.store.trades).toHaveLength(0);
  });

  test("intake can't exceed what was escrowed, and zero must go through a dispute", async () => {
    let w!: ReturnType<typeof world>;
    const tid = () => w.store.trades[0].id.slice(0, 6);
    w = world([...listAndBidTurns(), () => T("accept_offer", { trade_id: tid() }), say("ok"),
      () => T("confirm_delivery", { trade_id: tid(), accepted_quantity: 900 }), say("too much"),
      () => T("confirm_delivery", { trade_id: tid(), accepted_quantity: 0 }), say("zero")]);
    await listAndBid(w);
    await handle(w.deps, m(BRIQUETTES, { text: "accept" }));
    await handle(w.deps, m(BRIQUETTES, { text: "confirm 900" }));
    await handle(w.deps, m(BRIQUETTES, { text: "confirm 0" }));
    expect(w.store.trades[0].status).toBe("escrowed");
    expect(await w.store.balance(SYSTEM.escrow)).toBe(2000);
  });

  test("dispute: Meta AI recommends, a person decides, escrow splits", async () => {
    let w!: ReturnType<typeof world>;
    const tid = () => w.store.trades[0].id.slice(0, 6);
    w = world([
      ...listAndBidTurns(),
      () => T("accept_offer", { trade_id: tid() }), say("Paid into escrow."),
      () => T("dispute_trade", { trade_id: tid(), reason: "Half the sacks were wet and mouldy" }), say("Disputed; a reviewer will decide."),
      () => T("resolve_dispute", { trade_id: tid(), outcome: "split", seller_share_pct: 50, note: "Half usable per photos" }), say("Decided."),
    ], { mediation: { recommendation: "split", seller_share_pct: 50, evidence_summary: "Some sacks look wet in the delivery photo.", reasoning: "About half usable.", confidence: 0.8 } });
    const { store, deps, id } = w;
    await listAndBid(w);
    await handle(deps, m(BRIQUETTES, { text: `accept ${tid()}` }));
    await handle(deps, m(BRIQUETTES, { text: "half of it was wet" }));
    expect(store.trades[0]).toMatchObject({ status: "disputed", mediation: { recommendation: "split", seller_share_pct: 50 } });
    await handle(deps, m(REVIEWER, { text: "yes" }));
    await store.updateAccount(await id(REVIEWER), { roles: ["person", "ops"] });
    await handle(deps, m(REVIEWER, { text: "settle it 50/50" }));
    expect(store.trades[0]).toMatchObject({ status: "settled", decision: { outcome: "split", seller_share_pct: 50 } });
    expect(await store.balance(await id(FARMER))).toBe(970); // 1000 − 3%
    expect(await store.balance(await id(BRIQUETTES))).toBe(4000);
    expect(await store.balance(SYSTEM.escrow)).toBe(0);
  });

  test("a business can't accept an offer it can't pay for, and the model can't force it", async () => {
    let w!: ReturnType<typeof world>;
    const tid = () => w.store.trades[0].id.slice(0, 6);
    w = world([
      T("sell_waste", { material: "rice_husk", quantity: 500 }), say("photo?"), say("location?"), T("publish_listing"), say("listed"),
      T("register_business", { name: "Broke Ltd" }), say("ok"),
      T("buy_waste", { material: "rice_husk", quantity: 500, max_price: 5 }), say("offer"),
      () => T("accept_offer", { trade_id: tid() }), say("Not enough ECOIN."),
    ]);
    const { store, deps } = w;
    for (const p of [FARMER, BRIQUETTES]) await handle(deps, m(p, { text: "yes" }));
    await handle(deps, m(FARMER, { text: "sell husk" }));
    await handle(deps, m(FARMER, { kind: "image", image: { bytes: png(4), mime: "image/jpeg" } }));
    await handle(deps, m(FARMER, { kind: "location", location: { lat: 0, lng: 0 } }));
    await handle(deps, m(BRIQUETTES, { text: "we are Broke Ltd" }));
    await handle(deps, m(BRIQUETTES, { text: "buy 500 kg at 5" }));
    await handle(deps, m(BRIQUETTES, { text: "accept" }));
    expect(store.trades[0].status).toBe("proposed");
    expect(store.ledger).toHaveLength(0);
  });
});

describe("Loop rules", () => {
  const husk = MATERIALS.rice_husk, pet = MATERIALS.pet_bottles;
  const obs = (x: Record<string, unknown> = {}) => ({ ...LOT, code_seen: "K7P2", ...x }) as never;
  test("grade comes from condition; no price is ever produced", () => {
    const a = gradeLot(husk, 500, 10, obs(), "K7P2");
    expect(a).toMatchObject({ outcome: "listed", grade: "A", verified_quantity: 500 });
    expect("price" in a).toBe(false);
    expect(gradeLot(husk, 500, 10, obs({ condition_good: "no" }), "K7P2").grade).toBe("C");
  });
  test("code missing, wrong material, AI-made or far too little → not listed", () => {
    expect(gradeLot(husk, 500, 10, obs({ code_seen: "" }), "K7P2").outcome).toBe("needs_better_photo");
    expect(gradeLot(husk, 500, 10, obs({ matches_claim: "no", identified_as: "sawdust" }), "K7P2")).toMatchObject({ outcome: "rejected", reasons: ["The photo looks like sawdust and wood shavings, not rice husk."] });
    expect(gradeLot(husk, 500, 10, obs({ possibly_ai_generated_or_edited: true }), "K7P2").outcome).toBe("needs_better_photo");
    expect(gradeLot(husk, 500, 2, obs({ estimated_quantity: 100 }), "K7P2").outcome).toBe("needs_better_photo");
    expect(gradeLot(pet, 100, 40, obs({ estimated_quantity: 45, identified_as: "pet_bottles" }), "K7P2").outcome).toBe("needs_better_photo");
  });
  test("code matching tolerates how people write it", () => {
    expect(sameCode("k7p2", "K7P2")).toBe(true);
    expect(sameCode("Code: K 7 P 2", "K7P2")).toBe(true);
    expect(sameCode("K7P3", "K7P2")).toBe(false);
  });
  test("recyclable jerrycans are a separate countable category from PET bottles", () => {
    const jerrycans = MATERIALS.plastic_jerrycans;
    expect(jerrycans).toMatchObject({ unit: "items", sam: "plastic jerrycan", counts: "items" });
    expect(gradeLot(jerrycans, 8, 8, obs({ identified_as: "plastic_jerrycans", estimated_quantity: 8 }), "K7P2"))
      .toMatchObject({ outcome: "listed", grade: "A", verified_quantity: 8 });
    expect(gradeLot(jerrycans, 8, 8, obs({ identified_as: "pet_bottles", matches_claim: "no" }), "K7P2").outcome)
      .toBe("rejected");
  });
  test("best bid wins; grade floor, radius and self-dealing are enforced; price = the bid", () => {
    const l = { id: "l", seller: "s", material: "rice_husk", quantity: 500, price: 3, grade: "B", lat: 0, lng: 0 } as never;
    const d = (id: string, buyer: string, max_price: number, lng: number, min_grade = "C", radius_km = 25) => ({ id, buyer, material: "rice_husk", quantity: 300, max_price, min_grade, lat: 0, lng, radius_km, status: "open" }) as never;
    expect(bestMatch(l, [d("near", "b1", 4, 0.01), d("better", "b2", 5, 0.1)])).toMatchObject({ price: 5, quantity: 300 });
    expect(bestMatch(l, [d("picky", "b1", 9, 0, "A")])).toBeNull();
    expect(bestMatch(l, [d("far", "b1", 9, 1)])).toBeNull();
    expect(bestMatch(l, [d("self", "s", 9, 0)])).toBeNull();
    expect(bestMatch(l, [d("below-minimum", "b1", 2, 0)])).toBeNull();
  });
});

describe("Glance codes", () => {
  test("codes are hashed, expire and lock after 3 tries; phone numbers normalise", async () => {
    const p = { id: "p1", status: "pending", attempts: 0, expires_at: "2026-10-27T09:05:00Z", code_hash: await hashCode("p1", "123456") } as never;
    expect(await checkCode(p, "123456", new Date("2026-10-27T09:01:00Z"))).toBe("ok");
    expect(await checkCode(p, "000000", new Date("2026-10-27T09:01:00Z"))).toBe("wrong");
    expect(await checkCode(p, "123456", new Date("2026-10-27T09:06:00Z"))).toBe("expired");
    expect(await checkCode({ ...(p as object), attempts: 3 } as never, "123456", new Date("2026-10-27T09:01:00Z"))).toBe("locked");
    expect(normalisePhone("+254 700-000 001")).toBe("254700000001");
    expect(normalisePhone("00254700000001")).toBe("254700000001");
  });
});

