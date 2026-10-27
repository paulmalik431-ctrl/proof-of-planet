import { describe, expect, test } from "bun:test";
import { handle, type Inbound } from "../supabase/functions/_core/agent.ts";
import { MemoryStore } from "../supabase/functions/_core/store.ts";
import { supply, SYSTEM, verifyChain } from "../supabase/functions/_core/ledger.ts";
import { bestMatch, priceLot } from "../supabase/functions/_core/loop.ts";
import { checkCode, hashCode, normalisePhone } from "../supabase/functions/_core/glance.ts";
import { fakeMeta, png } from "./fake-meta.ts";

type Turn = { text: string } | { tools: Array<[string, Record<string, unknown>]> };
const T = (name: string, args: Record<string, unknown> = {}): Turn => ({ tools: [[name, args]] });
const say = (text: string): Turn => ({ text });

let n = 0;
const at = new Date("2026-10-27T09:00:00Z");
const SELLER = "254700000001", BUYER = "254700000002", SHOP = "254700000003", REVIEWER = "254700000009";
const m = (from: string, x: Partial<Inbound>): Inbound => ({ id: `m${++n}`, from, at, kind: "text", ...x });

const LOT = { material_matches: "yes", sorted_and_clean: "yes", estimated_quantity: 100, possibly_ai_generated_or_edited: false, confidence: 0.9, notes: "Sorted clear PET bottles." };

function world(agent: Turn[], extra: Record<string, Record<string, unknown>> = {}) {
  const store = new MemoryStore(() => at);
  const { meta, log } = fakeMeta({ sam: { "plastic bottle": 100 }, observation: {}, json: { lot_observation: LOT, ...extra }, agent });
  const deps = { store, meta, publicUrl: "https://eco.example", limits: { messagesPerDay: 100, verificationsPerDay: 10 } };
  const id = async (phone: string) => (await store.accountByPhone(phone))!.id;
  return { store, deps, log, id };
}

async function sellAndBuy(w: ReturnType<typeof world>) {
  const { deps } = w;
  for (const p of [SELLER, BUYER]) await handle(deps, m(p, { text: "yes" }));
  await handle(deps, m(SELLER, { text: "I have 100 plastic bottles to sell" }));
  await handle(deps, m(SELLER, { kind: "image", image: { bytes: png(3), mime: "image/jpeg" } }));
  await handle(deps, m(SELLER, { kind: "location", location: { lat: -1.30, lng: 36.80 } }));
  await handle(deps, m(BUYER, { text: "We are GreenCycle, a recycler" }));
  await handle(deps, m(BUYER, { text: "top up please" }));
  await handle(deps, m(BUYER, { kind: "location", location: { lat: -1.31, lng: 36.81 } }));
  await handle(deps, m(BUYER, { text: "buy 500 PET bottles, up to 3 ECOIN each" }));
}

const sellAndBuyTurns = (): Turn[] => [
  T("sell_waste", { material: "pet_bottles", quantity: 100 }), say("Send a photo of the lot."),
  say("Now the pickup location."),
  T("publish_listing"), say("Listed! Grade A, 2 ECOIN each."),
  T("register_business", { name: "GreenCycle" }), say("Registered."),
  T("top_up_test_ecoin"), say("5,000 test ECOIN added."),
  say("Location saved."),
  T("buy_waste", { material: "pet_bottles", quantity: 500, max_price: 3 }), say("Found an offer."),
];

describe("Loop + escrow + Glance, across three people", () => {
  test("earn → trade through escrow → spend in a shop, with fees to the Reserve", async () => {
    let w!: ReturnType<typeof world>;
    const tid = () => w.store.trades[0].id.slice(0, 6);
    w = world([
      ...sellAndBuyTurns(),
      () => T("accept_offer", { trade_id: tid() }), say("Paid into escrow."),
      say("Thanks — now tell me when it's delivered."),
      () => T("mark_delivered", { trade_id: tid() }), say("Buyer notified."),
      () => T("confirm_delivery", { trade_id: tid() }), say("Released."),
      T("register_shop", { name: "Mama Mboga" }), say("Shop registered."),
      T("charge_customer", { phone: `+${SELLER}`, amount: 150 }), say("Code sent; ask the customer."),
    ]);
    const { store, deps, id } = w;
    await sellAndBuy(w);

    expect(store.listings[0]).toMatchObject({ status: "reserved", grade: "A", price: 2, quantity: 100, sam_count: 100 });
    expect(store.trades[0]).toMatchObject({ status: "proposed", total: 200, buyer: await id(BUYER), seller: await id(SELLER) });

    await handle(deps, m(BUYER, { text: `accept ${tid()}` }));
    expect(await store.balance(SYSTEM.escrow)).toBe(200);
    expect(await store.balance(await id(BUYER))).toBe(4800);
    expect((await store.drain(await id(SELLER))).join()).toContain("escrow");

    await handle(deps, m(SELLER, { kind: "image", image: { bytes: png(7), mime: "image/jpeg" } }));
    await handle(deps, m(SELLER, { text: `delivered ${tid()}` }));
    expect(store.trades[0].status).toBe("delivered");
    expect((await store.drain(await id(BUYER))).join()).toContain(`confirm ${tid()}`);

    await handle(deps, m(BUYER, { text: `confirm ${tid()}` }));
    expect(store.trades[0].status).toBe("released");
    expect(store.listings[0].status).toBe("sold");
    expect(await store.balance(SYSTEM.escrow)).toBe(0);
    expect(await store.balance(await id(SELLER))).toBe(194); // 200 − 3% (6)
    expect(await store.balance(SYSTEM.treasury)).toBe(5);
    expect(await store.balance(SYSTEM.reserve)).toBe(1);

    await handle(deps, m(SHOP, { text: "yes" }));
    await handle(deps, m(SHOP, { text: "I run a shop called Mama Mboga" }));
    await handle(deps, m(SHOP, { text: `charge ${SELLER} 150` }));
    const sms = (await store.drain(await id(SELLER))).join();
    const code = /\*(\d{6})\*/.exec(sms)![1];
    expect(store.payments[0].code_hash).not.toContain(code); // only the hash is stored

    expect((await handle(deps, m(SHOP, { text: "000000" })))[0]).toContain("Wrong code");
    expect((await handle(deps, m(SHOP, { text: code })))[0]).toContain("Paid: 150");
    expect(await store.balance(await id(SELLER))).toBe(44);
    expect(await store.balance(await id(SHOP))).toBe(149); // 1% fee

    expect((await verifyChain(store.ledger)).ok).toBe(true);
    expect(supply(store.ledger)).toMatchObject({ minted: 0, deposits: 5000, balanced: true });
  });

  test("dispute: Meta AI recommends, a person decides, escrow splits", async () => {
    let w!: ReturnType<typeof world>;
    const tid = () => w.store.trades[0].id.slice(0, 6);
    w = world([
      ...sellAndBuyTurns(),
      () => T("accept_offer", { trade_id: tid() }), say("Paid into escrow."),
      () => T("dispute_trade", { trade_id: tid(), reason: "Only half the bottles arrived" }), say("Disputed; a reviewer will decide."),
      () => T("resolve_dispute", { trade_id: tid(), outcome: "split", seller_share_pct: 50, note: "Half delivered per photos" }), say("Decided."),
    ], { mediation: { recommendation: "split", seller_share_pct: 50, evidence_summary: "Fewer bottles in the delivery photo.", reasoning: "About half delivered.", confidence: 0.8 } });
    const { store, deps, id } = w;
    await sellAndBuy(w);
    await handle(deps, m(BUYER, { text: `accept ${tid()}` }));
    await handle(deps, m(BUYER, { text: "only half arrived" }));
    expect(store.trades[0]).toMatchObject({ status: "disputed", mediation: { recommendation: "split", seller_share_pct: 50 } });

    // A reviewer (ops role) decides; the AI's recommendation is advice only.
    await handle(deps, m(REVIEWER, { text: "yes" }));
    await store.updateAccount(await id(REVIEWER), { roles: ["person", "ops"] });
    await handle(deps, m(REVIEWER, { text: "settle it 50/50" }));
    expect(store.trades[0]).toMatchObject({ status: "settled", decision: { outcome: "split", seller_share_pct: 50 } });
    expect(await store.balance(await id(SELLER))).toBe(97); // 100 − 3%
    expect(await store.balance(await id(BUYER))).toBe(4900);
    expect(await store.balance(SYSTEM.escrow)).toBe(0);
  });

  test("a business can't accept an offer it can't pay for, and the model can't force it", async () => {
    let w!: ReturnType<typeof world>;
    const tid = () => w.store.trades[0].id.slice(0, 6);
    w = world([
      T("sell_waste", { material: "pet_bottles", quantity: 100 }), say("photo?"), say("location?"), T("publish_listing"), say("listed"),
      T("register_business", { name: "Broke Ltd" }), say("ok"),
      T("buy_waste", { material: "pet_bottles", quantity: 100, max_price: 5 }), say("offer"),
      () => T("accept_offer", { trade_id: tid() }), say("Not enough ECOIN."),
    ]);
    const { store, deps } = w;
    for (const p of [SELLER, BUYER]) await handle(deps, m(p, { text: "yes" }));
    await handle(deps, m(SELLER, { text: "sell bottles" }));
    await handle(deps, m(SELLER, { kind: "image", image: { bytes: png(4), mime: "image/jpeg" } }));
    await handle(deps, m(SELLER, { kind: "location", location: { lat: 0, lng: 0 } }));
    await handle(deps, m(BUYER, { text: "we are Broke Ltd" }));
    await handle(deps, m(BUYER, { text: "buy 100 bottles at 5" }));
    await handle(deps, m(BUYER, { text: "accept" }));
    expect(store.trades[0].status).toBe("proposed");
    expect(store.ledger).toHaveLength(0);
  });
});

describe("Loop pricing and matching rules", () => {
  const mat = { id: "pet_bottles" as const, title: "PET plastic bottles", unit: "items" as const, sam: "plastic bottle", refPrice: 2 };
  test("grade drives price; quantity can't exceed what the photo supports", () => {
    expect(priceLot(mat, 100, 100, { ...LOT, sorted_and_clean: "yes" } as never)).toMatchObject({ outcome: "priced", grade: "A", price: 2, verified_quantity: 100 });
    expect(priceLot(mat, 100, 90, { ...LOT, sorted_and_clean: "no", estimated_quantity: 90 } as never)).toMatchObject({ outcome: "priced", grade: "C", price: 1, verified_quantity: 90 });
    expect(priceLot(mat, 500, 40, { ...LOT, estimated_quantity: 45 } as never).outcome).toBe("needs_better_photo");
    expect(priceLot(mat, 100, 0, { ...LOT, material_matches: "no" } as never).outcome).toBe("rejected");
    expect(priceLot(mat, 100, 100, { ...LOT, possibly_ai_generated_or_edited: true } as never).outcome).toBe("needs_better_photo");
  });
  test("matching prefers the best price, respects radius and never matches a seller with themself", () => {
    const l = { id: "l", seller: "s", material: "pet_bottles", quantity: 100, price: 2, lat: 0, lng: 0 } as never;
    const d = (id: string, buyer: string, max_price: number, lng: number, radius_km = 25) => ({ id, buyer, material: "pet_bottles", quantity: 60, max_price, lat: 0, lng, radius_km, status: "open" }) as never;
    expect(bestMatch(l, [d("near", "b1", 2, 0.01), d("better", "b2", 3, 0.1)])?.demand.id).toBe("better");
    expect(bestMatch(l, [d("far", "b1", 9, 1, 25)])).toBeNull();
    expect(bestMatch(l, [d("self", "s", 9, 0)])).toBeNull();
    expect(bestMatch(l, [d("cheap", "b1", 1, 0)])).toBeNull();
    expect(bestMatch(l, [d("ok", "b1", 2, 0)])?.quantity).toBe(60);
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

