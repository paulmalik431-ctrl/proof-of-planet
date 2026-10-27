import { describe, expect, test } from "bun:test";
import { canonical, checkLegs, GENESIS, seal, sha256Hex, supply, SYSTEM, verifyChain } from "../supabase/functions/_core/ledger.ts";
import { escrowLock, escrowRelease, escrowSplit, payment, split } from "../supabase/functions/_core/money.ts";
import { MemoryStore } from "../supabase/functions/_core/store.ts";

describe("ECOIN ledger", () => {
  test("canonical form is stable (the SQL function must produce the same string)", async () => {
    const e = { seq: 1, prev_hash: GENESIS, account_id: "eco_abc", amount: 100, kind: "reward" as const, ref: "c1", memo: "Tree planting", at: "2026-10-26T18:00:00.000Z" };
    expect(canonical(e)).toBe(`1|${GENESIS}|eco_abc|100|reward|c1|Tree planting|2026-10-26T18:00:00.000Z`);
    expect((await seal(e)).hash).toBe(await sha256Hex(canonical(e)));
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("chain verifies, and any edit, deletion or re-hashed forgery is caught", async () => {
    const s = new MemoryStore();
    for (const amount of [100, 45, 400]) await s.post([{ account_id: "eco_a", amount, kind: "reward" }], null, "x");
    expect(await verifyChain(s.ledger)).toEqual({ ok: true, brokenAt: null });
    const edited = s.ledger.map((e) => ({ ...e }));
    edited[1].amount = 4500;
    expect((await verifyChain(edited)).brokenAt).toBe(2);
    expect((await verifyChain([s.ledger[0], s.ledger[2]])).brokenAt).toBe(3);
    const forged = s.ledger.map((e) => ({ ...e }));
    forged[1] = await seal({ ...forged[1], amount: 4500 });
    expect((await verifyChain(forged)).brokenAt).toBe(3);
  });

  test("posting rules: no proof no token, transfers sum to zero, no overdraft", () => {
    const bal = (a: string) => (a === "rich" ? 100 : 0);
    expect(checkLegs([{ account_id: "a", amount: 10, kind: "reward" }], bal)).toBeNull();
    expect(checkLegs([{ account_id: "a", amount: 10, kind: "payment" }], bal)).toBe("transfer legs must sum to zero");
    expect(checkLegs([{ account_id: "a", amount: -10, kind: "reward" }], bal)).toBe("minting cannot debit");
    expect(checkLegs([{ account_id: "rich", amount: -10, kind: "reward" }, { account_id: "b", amount: 10, kind: "payment" }], bal)).toBe("mint kinds cannot be mixed with transfers");
    expect(checkLegs(payment("poor", "shop", 50).legs, bal)).toContain("insufficient");
    expect(checkLegs(payment("rich", "shop", 50).legs, bal)).toBeNull();
    expect(checkLegs([{ account_id: "a", amount: 1.5, kind: "reward" }], bal)).toContain("whole");
  });
});

describe("fees and the Reserve", () => {
  test("3% Loop fee and 1% Glance fee, 30% of every fee to the Reserve", () => {
    expect(split(1000, 300)).toEqual({ fee: 30, treasury: 21, reserve: 9, net: 970 });
    const r = escrowRelease("seller", 1000);
    expect(r.legs.reduce((s, l) => s + l.amount, 0)).toBe(0);
    expect(r.legs.find((l) => l.account_id === SYSTEM.reserve)?.amount).toBe(9);
    expect(payment("c", "s", 200).split).toEqual({ fee: 2, treasury: 2, reserve: 0, net: 198 });
  });
  test("full lifecycle keeps supply equal to what was minted", async () => {
    const s = new MemoryStore();
    await s.post([{ account_id: "buyer", amount: 5000, kind: "deposit" }], null, "test");
    await s.post([{ account_id: "seller", amount: 100, kind: "reward" }], "claim", "Witness");
    await s.post(escrowLock("buyer", 1000), "t1", "escrow");
    expect(await s.balance(SYSTEM.escrow)).toBe(1000);
    await s.post(escrowRelease("seller", 1000).legs, "t1", "release");
    await s.post(escrowLock("buyer", 400), "t2", "escrow");
    await s.post(escrowSplit("seller", "buyer", 400, 100).legs, "t2", "split");
    await s.post(payment("seller", "shop", 300).legs, "p1", "glance");
    expect(await s.balance(SYSTEM.escrow)).toBe(0);
    expect(supply(s.ledger)).toEqual({ minted: 100, deposits: 5000, total: 5100, balanced: true });
    expect(await s.balance("buyer")).toBe(5000 - 1000 - 100);
    expect((await verifyChain(s.ledger)).ok).toBe(true);
  });
});
