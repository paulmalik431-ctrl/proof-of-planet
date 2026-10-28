// K0 · Escrow invariants. Escrow is one pooled account, so these tests check that no repeated, concurrent,
// misdirected or rounding-edge settlement can pay out more than a trade locked, or touch another trade's collateral.
import { describe, expect, test } from "bun:test";
import { checkLegs, supply, SYSTEM, verifyChain } from "../supabase/functions/_core/ledger.ts";
import { escrowLock, escrowRefund, escrowRelease } from "../supabase/functions/_core/money.ts";
import { MemoryStore } from "../supabase/functions/_core/store.ts";
import { settleIntake } from "../supabase/functions/_core/tools.ts";
import { hashCode } from "../supabase/functions/_core/glance.ts";
import type { Intake, Trade } from "../supabase/functions/_core/loop.ts";

const at = new Date("2026-10-28T09:00:00Z");

/** One buyer with 5,000 test ECOIN and two escrowed trades: T1 = 500 kg × 4 (2,000), T2 = 250 kg × 4 (1,000). */
async function twoTrades() {
  const store = new MemoryStore(() => at);
  const buyer = await store.createAccount("254700000010");
  const s1 = await store.createAccount("254700000011");
  const s2 = await store.createAccount("254700000012");
  await store.post([{ account_id: buyer.id, amount: 5000, kind: "deposit" }], null, "Test deposit");
  const mk = async (seller: string, quantity: number) => {
    const l = await store.createListing({ seller, material: "rice_husk", quantity, unit: "kg", price: 0, grade: "A", sam_count: 10, challenge: "K7P2", photo_path: null, photo_sha256: null, lat: 0, lng: 0, status: "reserved", assessment: null } as never);
    const d = await store.createDemand({ buyer: buyer.id, material: "rice_husk", quantity: 1000, max_price: 4, min_grade: "C", lat: 0, lng: 0, radius_km: 25, status: "open" } as never);
    const t = await store.createTrade({ listing_id: l.id, demand_id: d.id, seller, buyer: buyer.id, material: "rice_husk", quantity, unit: "kg", price: 4, total: 4 * quantity, intake: null, intake_code_hash: null, distance_km: 1, status: "escrowed", delivery_photo_path: null, dispute: null, mediation: null, decision: null, history: [] } as never);
    await store.post(escrowLock(buyer.id, t.total), t.id, "lock");
    return t;
  };
  const t1 = await mk(s1.id, 500);
  const t2 = await mk(s2.id, 250);
  const deps = { store, meta: null as never, publicUrl: "https://eco.example", limits: { messagesPerDay: 0, verificationsPerDay: 0 } };
  const intake = (t: Trade, accepted_quantity: number, by = buyer.id, via: Intake["via"] = "whatsapp"): Intake => ({ accepted_quantity, grade: "A", note: "", by, via, at: at.toISOString() });
  return { store, deps, buyer, s1, s2, t1, t2, intake };
}

describe("Escrow invariants (K0)", () => {
  test("ledger rule: escrow moves need a trade ref, lock once, and never pay out more than that trade locked", () => {
    const pool = 3000; // pooled escrow balance across two trades
    const bal = (a: string) => (a === SYSTEM.escrow ? pool : 5000);
    const held = (r: string) => (r === "t1" ? 2000 : r === "t2" ? 1000 : 0);
    expect(checkLegs(escrowRelease("s", 2000).legs, bal, null, held)).toBe("escrow moves need a trade reference");
    expect(checkLegs(escrowLock("b", 2000), bal, "t1", held)).toBe("this trade is already in escrow");
    expect(checkLegs(escrowRelease("s", 2000).legs, bal, "t1", held)).toBeNull();
    // Pool has 3,000, but t2 locked only 1,000: paying 2,000 against t2 would spend t1's collateral.
    expect(checkLegs(escrowRelease("s", 2000).legs, bal, "t2", held)).toBe("escrow for this trade is already settled");
    expect(checkLegs(escrowRefund("b", 1), bal, "t3", held)).toBe("escrow for this trade is already settled");
  });

  test("repeated intake pays once; the second gets a plain error and nothing moves", async () => {
    const { store, deps, s1, t1, intake } = await twoTrades();
    const first = await settleIntake(deps, t1, intake(t1, 500), at);
    expect(first).toMatchObject({ accepted_quantity: 500, seller_received: 1940 });
    const before = store.ledger.length;
    const again = await settleIntake(deps, t1, intake(t1, 500), at); // stale copy still says "escrowed"
    expect(again.error).toContain("released");
    expect(store.ledger).toHaveLength(before);
    expect(await store.balance(s1.id)).toBe(1940);
  });

  test("two intakes at the same moment (WhatsApp + web): exactly one pays, and the other trade's escrow is untouched", async () => {
    const { store, deps, buyer, s1, s2, t1, t2, intake } = await twoTrades();
    const results = await Promise.all([settleIntake(deps, t1, intake(t1, 500), at), settleIntake(deps, t1, intake(t1, 500, buyer.id, "web"), at)]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.filter((r) => r.error)).toHaveLength(1);
    expect(await store.balance(s1.id)).toBe(1940);
    expect(await store.balance(SYSTEM.escrow)).toBe(1000); // T2's collateral intact
    expect(await settleIntake(deps, t2, intake(t2, 250), at)).toMatchObject({ seller_received: 970 });
    expect(await store.balance(s2.id)).toBe(970);
    expect(await store.balance(SYSTEM.escrow)).toBe(0);
    expect(await store.balance(buyer.id)).toBe(2000);
    expect((await verifyChain(store.ledger)).ok).toBe(true);
    expect(supply(store.ledger)).toMatchObject({ minted: 0, deposits: 5000, balanced: true });
  });

  test("a double lock is refused by the ledger even if the status check is raced", async () => {
    const { store, buyer, t1 } = await twoTrades();
    await expect(store.post(escrowLock(buyer.id, t1.total), t1.id, "lock again")).rejects.toThrow("already in escrow");
    expect(await store.balance(SYSTEM.escrow)).toBe(3000);
  });

  test("only the buyer can record the intake; the seller or a stranger can't release escrow", async () => {
    const { store, deps, s1, t1, intake } = await twoTrades();
    const stranger = await store.createAccount("254700000099");
    expect((await settleIntake(deps, t1, intake(t1, 500, s1.id), at)).error).toContain("Only the buyer");
    expect((await settleIntake(deps, t1, intake(t1, 500, stranger.id), at)).error).toContain("Only the buyer");
    expect(await store.balance(SYSTEM.escrow)).toBe(3000);
  });

  test("an intake code only opens its own trade", async () => {
    const { t1, t2 } = await twoTrades();
    const code = "482913";
    const h1 = await hashCode(t1.id, code);
    expect(await hashCode(t1.id, code)).toBe(h1);
    expect(await hashCode(t2.id, code)).not.toBe(h1);
  });

  test("partial acceptance: paid for what was weighed, the rest returns, fees only on the paid part", async () => {
    const { store, deps, buyer, s1, t1, intake } = await twoTrades();
    const r = await settleIntake(deps, t1, intake(t1, 333.33), at);
    // 333.3 kg × 4 = 1,333 (rounded) to the seller side; 3% = 39 fees (reserve 11, treasury 28); 667 back.
    expect(r).toMatchObject({ accepted_quantity: 333.3, seller_received: 1294, fees: 39, to_reserve: 11, returned_to_buyer: 667 });
    expect(await store.balance(s1.id)).toBe(1294);
    expect(await store.balance(buyer.id)).toBe(2000 + 667);
    expect(await store.balance(SYSTEM.escrow)).toBe(1000);
  });

  test("an intake worth under 1 ECOIN, zero, negative, or more than escrowed pays nothing", async () => {
    const { store, deps, t1, intake } = await twoTrades();
    for (const q of [0.1, 0, -5, Number.NaN, 501]) expect((await settleIntake(deps, t1, intake(t1, q), at)).error).toBeTruthy();
    expect(await store.balance(SYSTEM.escrow)).toBe(3000);
    expect((await store.trade(t1.id))!.status).toBe("escrowed");
  });

  test("a disputed trade can't be settled by intake; refunded or released trades stay closed", async () => {
    const { store, deps, t1, t2, intake } = await twoTrades();
    await store.updateTrade(t1.id, { status: "disputed" });
    expect((await settleIntake(deps, t1, intake(t1, 500), at)).error).toContain("disputed");
    await store.post(escrowRefund((await store.trade(t2.id))!.buyer, t2.total), t2.id, "refund");
    await store.updateTrade(t2.id, { status: "refunded" });
    expect((await settleIntake(deps, t2, intake(t2, 250), at)).error).toContain("refunded");
    // Even with the status wrongly reset, the ledger refuses to pay out the refunded collateral again.
    await store.updateTrade(t2.id, { status: "escrowed" });
    expect((await settleIntake(deps, t2, intake(t2, 250), at)).error).toContain("already settled");
    expect(await store.balance(SYSTEM.escrow)).toBe(2000);
  });
});
