import { describe, expect, test } from "bun:test";
import { handle, type Inbound } from "../supabase/functions/_core/agent.ts";
import { MemoryStore } from "../supabase/functions/_core/store.ts";
import { checkLegs, SYSTEM, supply, verifyChain } from "../supabase/functions/_core/ledger.ts";
import { ADOPTION, adoptionPayment } from "../supabase/functions/_core/money.ts";
import { runTool } from "../supabase/functions/_core/tools.ts";
import { claimFacts } from "../supabase/functions/_core/proofcard.ts";
import { fakeMeta } from "./fake-meta.ts";

const at = new Date("2026-11-03T09:00:00Z");
let n = 0;
const m = (from: string, x: Partial<Inbound>): Inbound => ({ id: `a${++n}`, from, at, kind: "text", ...x });

async function world() {
  const store = new MemoryStore(() => at);
  const { meta } = fakeMeta({ agent: [] });
  const deps = { store, meta, publicUrl: "https://eco.example", limits: { messagesPerDay: 100, verificationsPerDay: 10 } };
  const planter = await store.createAccount("254700000011");
  const company = await store.createAccount("254700000012");
  for (const a of [planter, company]) await store.updateAccount(a.id, { consent_at: at.toISOString() });
  await store.updateAccount(company.id, { roles: ["person", "business"], name: "Acme Kenya" });
  // A verified tree: the reward is minted by the verified action, as in verify_claim.
  const tree = await store.createClaim({ account_id: planter.id, protocol: "tree_planting", parent_id: null });
  await store.updateClaim(tree.id, { status: "consistent", reward: 100, verified_at: at.toISOString() });
  await store.post([{ account_id: planter.id, amount: 100, kind: "reward" }], tree.id, "Tree planting verified");
  const ctx = async (id: string) => ({ deps, account: (await store.accountById(id))!, session: { account_id: id, history: [], open_claim_id: null, open_listing_id: null, last_location: null, day: "2026-11-03", messages_today: 0, verifications_today: 0 }, now: at });
  return { store, deps, planter, company, tree, ctx };
}

describe("Tree adoption", () => {
  test("the fixed price is a balanced transfer that never mints", () => {
    const { legs, split } = adoptionPayment("biz", "planter");
    expect(legs.reduce((s, l) => s + l.amount, 0)).toBe(0);
    expect(legs.some((l) => l.kind === "reward" || l.kind === "deposit")).toBe(false);
    expect(split.net + split.fee).toBe(ADOPTION.price);
    expect(checkLegs(legs, (a) => (a === "biz" ? ADOPTION.price : 0))).toBeNull();
    expect(checkLegs(legs, () => 0)).not.toBeNull(); // a company can't adopt with ECOIN it doesn't have
  });

  test("a company adopts a verified tree once; the planter is paid; supply is unchanged", async () => {
    const w = await world();
    const c = await w.ctx(w.company.id);
    expect(await runTool(c, "adopt_tree", {})).toMatchObject({ error: expect.stringContaining("balance") });
    await runTool(c, "top_up_test_ecoin", {});
    const minted = supply(w.store.ledger).minted;
    const list = await runTool(c, "trees_to_adopt", {}) as { trees: Array<{ id: string }>; price_ecoin: number };
    expect(list.price_ecoin).toBe(ADOPTION.price);
    expect(list.trees[0].id).toBe(w.tree.id.slice(0, 6));
    const r = await runTool(c, "adopt_tree", { tree_id: list.trees[0].id }) as Record<string, unknown>;
    expect(r.adopted).toBe(w.tree.id.slice(0, 6));
    expect(await w.store.balance(w.planter.id)).toBe(100 + (r.planter_received as number));
    expect(await w.store.balance(w.company.id)).toBe(5000 - ADOPTION.price);
    expect(await w.store.balance(SYSTEM.reserve)).toBe(r.to_reserve as number);
    expect(supply(w.store.ledger).minted).toBe(minted); // adoption moves ECOIN; only the verified action minted it
    expect((await verifyChain(w.store.ledger)).ok).toBe(true);
    // Once only.
    expect(await runTool(c, "adopt_tree", { tree_id: list.trees[0].id })).toMatchObject({ error: expect.any(String) });
    expect((await runTool(c, "trees_to_adopt", {}) as { trees: unknown[] }).trees).toHaveLength(0);
    // The planter is told, and the Proof Card shows the adopter.
    expect((await w.store.drain(w.planter.id)).join(" ")).toContain("Acme Kenya");
    const facts = claimFacts(w.tree, "https://eco.example", await w.store.adoptionOf(w.tree.id));
    expect(facts.lines.join(" ")).toContain(`Adopted by Acme Kenya · ${ADOPTION.price} ECOIN`);
  });

  test("only companies adopt, never their own tree, and only verified trees", async () => {
    const w = await world();
    expect(await runTool(await w.ctx(w.planter.id), "adopt_tree", {})).toMatchObject({ error: expect.stringContaining("company") });
    const other = await w.store.createClaim({ account_id: w.planter.id, protocol: "tree_planting", parent_id: null });
    await w.store.updateClaim(other.id, { status: "unresolved" });
    const c = await w.ctx(w.company.id);
    await runTool(c, "top_up_test_ecoin", {});
    expect(await runTool(c, "adopt_tree", { tree_id: other.id.slice(0, 6) })).toMatchObject({ error: expect.any(String) });
    const own = await w.store.createClaim({ account_id: w.company.id, protocol: "tree_planting", parent_id: null });
    await w.store.updateClaim(own.id, { status: "consistent", reward: 100, verified_at: at.toISOString() });
    expect((await runTool(c, "trees_to_adopt", {}) as { trees: Array<{ id: string }> }).trees.map((t) => t.id)).not.toContain(own.id.slice(0, 6));
  });

  test("the welcome asks every new person their role", async () => {
    const w = await world();
    await handle(w.deps, m("254700000099", { text: "Hello" }));
    const [welcome] = await handle(w.deps, m("254700000099", { text: "Yes" }));
    expect(welcome).toContain("Who are you today?");
    expect(welcome).toContain("adopt trees");
  });
});
