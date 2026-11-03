import { describe, expect, test } from "bun:test";
import { MemoryStore } from "../supabase/functions/_core/store.ts";
import { SYSTEM, verifyChain } from "../supabase/functions/_core/ledger.ts";
import { runTool } from "../supabase/functions/_core/tools.ts";
import { fakeMeta } from "./fake-meta.ts";

const at = new Date("2026-11-03T10:00:00Z");

async function world() {
  const store = new MemoryStore(() => at);
  const { meta } = fakeMeta({ agent: [] });
  const deps = { store, meta, publicUrl: "https://eco.example", limits: { messagesPerDay: 100, verificationsPerDay: 10 } };
  const seller = await store.createAccount("254700000021");
  const recycler = await store.createAccount("254700000022");
  for (const a of [seller, recycler]) await store.updateAccount(a.id, { consent_at: at.toISOString() });
  await store.updateAccount(recycler.id, { roles: ["person", "business"], name: "Jerry Recyclers" });
  const lot = await store.createListing({
    seller: seller.id, material: "plastic_jerrycans", quantity: 20, unit: "items", price: 0, grade: "B", sam_count: 20, challenge: "QCSG",
    photo_path: "x.jpg", photo_sha256: null, lat: -1.28, lng: 36.82, status: "open", assessment: null,
  });
  const ctx = async (id: string) => ({ deps, account: (await store.accountById(id))!, session: { account_id: id, history: [], open_claim_id: null, open_listing_id: null, last_location: null, day: "2026-11-03", messages_today: 0, verifications_today: 0 }, now: at });
  return { store, seller, recycler, lot, ctx };
}

describe("P2P: buyers see the uploaded lot and buy it directly", () => {
  test("open_listings shows the lot with its photo page; an offer locks escrow at once; the count settles it", async () => {
    const w = await world();
    const c = await w.ctx(w.recycler.id);
    const seen = await runTool(c, "open_listings", {}) as { for_sale: Array<{ id: string; photo_page: string }> };
    expect(seen.for_sale[0].id).toBe(w.lot.id.slice(0, 6));
    expect(seen.for_sale[0].photo_page).toContain(`listing.html?id=${w.lot.id}`);
    // No ECOIN yet: refused, the lot stays for sale.
    expect(await runTool(c, "offer_on_listing", { listing_id: w.lot.id.slice(0, 6), price: 30 })).toMatchObject({ error: expect.stringContaining("needs 600") });
    expect((await w.store.listing(w.lot.id))!.status).toBe("open");
    await runTool(c, "top_up_test_ecoin", {});
    const r = await runTool(c, "offer_on_listing", { listing_id: w.lot.id.slice(0, 6), price: 30 }) as Record<string, unknown>;
    expect(r.escrowed).toBe(600);
    expect(await w.store.balance(SYSTEM.escrow)).toBe(600);
    expect((await w.store.listing(w.lot.id))!.status).toBe("reserved");
    expect((await w.store.drain(w.seller.id)).join(" ")).toContain("paid 600 ECOIN into escrow");
    // A second offer on the same lot is refused.
    expect(await runTool(c, "offer_on_listing", { listing_id: w.lot.id.slice(0, 6), price: 40 })).toMatchObject({ error: expect.any(String) });
    // The recycler counts 18 of 20: the seller is paid for 18, 60 goes back.
    const t = w.store.trades[0];
    await runTool(c, "confirm_delivery", { trade_id: t.id.slice(0, 6), accepted_quantity: 18 });
    expect(await w.store.balance(SYSTEM.escrow)).toBe(0);
    expect(await w.store.balance(w.recycler.id)).toBe(5000 - 540);
    expect((await verifyChain(w.store.ledger)).ok).toBe(true);
  });

  test("only businesses buy, never their own lot, never below the seller's minimum", async () => {
    const w = await world();
    expect(await runTool(await w.ctx(w.seller.id), "offer_on_listing", { listing_id: w.lot.id.slice(0, 6), price: 30 })).toMatchObject({ error: expect.stringContaining("business") });
    await w.store.updateListing(w.lot.id, { price: 25 });
    const c = await w.ctx(w.recycler.id);
    await runTool(c, "top_up_test_ecoin", {});
    expect(await runTool(c, "offer_on_listing", { listing_id: w.lot.id.slice(0, 6), price: 20 })).toMatchObject({ error: expect.stringContaining("minimum is 25") });
  });
});
