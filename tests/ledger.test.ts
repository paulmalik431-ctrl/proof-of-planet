import { describe, expect, test } from "bun:test";
import { canonical, GENESIS, seal, sha256Hex, verifyChain } from "../supabase/functions/_core/ledger.ts";
import { MemoryStore } from "../supabase/functions/_core/store.ts";

describe("ECOIN ledger", () => {
  test("canonical form is stable (the SQL function must produce the same string)", async () => {
    const e = { seq: 1, prev_hash: GENESIS, account_id: "eco_abc", amount: 100, kind: "reward" as const, claim_id: "c1", memo: "Tree planting", at: "2026-10-26T18:00:00.000Z" };
    expect(canonical(e)).toBe(`1|${GENESIS}|eco_abc|100|reward|c1|Tree planting|2026-10-26T18:00:00.000Z`);
    expect((await seal(e)).hash).toBe(await sha256Hex(canonical(e)));
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("chain verifies, and any edit, deletion or reorder is caught", async () => {
    const s = new MemoryStore();
    for (const amount of [100, 45, 400]) await s.appendLedger({ account_id: "eco_a", amount, kind: "reward", claim_id: null, memo: "x" });
    expect(await verifyChain(s.ledger)).toEqual({ ok: true, brokenAt: null });

    const edited = s.ledger.map((e) => ({ ...e }));
    edited[1].amount = 4500;
    expect((await verifyChain(edited)).brokenAt).toBe(2);

    expect((await verifyChain([s.ledger[0], s.ledger[2]])).brokenAt).toBe(3);

    const forged = s.ledger.map((e) => ({ ...e }));
    forged[1] = await seal({ ...forged[1], amount: 4500 }); // re-hashed forgery still breaks the next link
    expect((await verifyChain(forged)).brokenAt).toBe(3);
  });

  test("balance sums an account's entries", async () => {
    const s = new MemoryStore();
    await s.appendLedger({ account_id: "a", amount: 100, kind: "reward", claim_id: null, memo: "" });
    await s.appendLedger({ account_id: "b", amount: 7, kind: "reward", claim_id: null, memo: "" });
    await s.appendLedger({ account_id: "a", amount: -30, kind: "spend", claim_id: null, memo: "" });
    expect(await s.balance("a")).toBe(70);
  });
});
