import { describe, expect, test } from "bun:test";
import { claimFacts, proofCardPrompt, tradeFacts } from "../supabase/functions/_core/proofcard.ts";
import { MATERIALS } from "../supabase/functions/_core/loop.ts";
import { STARTABLE } from "../supabase/functions/_core/protocols.ts";

describe("Proof Card", () => {
  test("the art prompt never contains numbers, text or evidence", () => {
    const prompts = [...STARTABLE.map((p) => proofCardPrompt({ kind: "claim", protocol: p })), proofCardPrompt({ kind: "claim", protocol: "tree_survival" }),
      ...Object.keys(MATERIALS).map((m) => proofCardPrompt({ kind: "trade", material: m as never }))];
    for (const p of prompts) {
      expect(p).not.toMatch(/\d/);
      expect(p).toContain("no text");
      expect(p).toContain("no numbers");
    }
  });
  test("printed figures come only from the stored record", () => {
    const c = claimFacts({ id: "c1", protocol: "tree_planting", reward: 100, verified_at: "2026-11-02T10:00:00Z" }, "https://eco.example");
    expect(c.lines[0]).toBe("100 ECOIN minted for this action");
    expect(c.evidence).toBe("https://eco.example/claim.html?id=c1");
    const t = tradeFacts({ id: "t1", material: "rice_husk", unit: "kg", intake: { accepted_quantity: 450 }, price: 4 }, "https://eco.example");
    expect(t.title).toBe("Rice husk → fuel briquettes");
    expect(t.lines[0]).toBe("450 kg weighed and accepted by the buyer");
  });
});
