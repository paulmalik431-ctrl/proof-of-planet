import { describe, expect, test } from "bun:test";
import { PROTOCOLS } from "../supabase/functions/_core/protocols.ts";
import { type Context, decide, haversineM, type Observation } from "../supabase/functions/_core/rules.ts";

const ctx: Context = { duplicatePhoto: false, daysSinceParent: null, distanceFromParentM: null, hasLocation: true };
const obs = (answers: Observation["answers"], extra: Partial<Observation> = {}): Observation =>
  ({ answers, possibly_ai_generated_or_edited: false, confidence: 0.9, notes: "", better_evidence: "", ...extra });
const tree = obs({ young_tree_in_ground: "yes", recently_planted: "yes", potted_or_indoor: "no" });

describe("tree planting", () => {
  const p = PROTOCOLS.tree_planting;
  test("clean evidence pays 100", () => {
    expect(decide(p, tree, { planting: 1 }, ctx)).toEqual({ outcome: "consistent", reasons: ["All checks passed."], reward: 100 });
  });
  test("SAM finds nothing → unresolved, no pay", () => {
    const d = decide(p, tree, { planting: 0 }, ctx);
    expect(d.outcome).toBe("unresolved");
    expect(d.reward).toBe(0);
    expect(d.reasons[0]).toContain("SAM 3.1");
  });
  test("confident potted plant → contradicted", () => {
    expect(decide(p, obs({ ...tree.answers, potted_or_indoor: "yes" }), { planting: 1 }, ctx).outcome).toBe("contradicted");
  });
  test("low-confidence potted plant → only unresolved", () => {
    expect(decide(p, obs({ ...tree.answers, potted_or_indoor: "yes" }, { confidence: 0.5 }), { planting: 1 }, ctx).outcome).toBe("unresolved");
  });
  test("soft question wrong never contradicts", () => {
    expect(decide(p, obs({ ...tree.answers, recently_planted: "no" }), { planting: 1 }, ctx).outcome).toBe("unresolved");
  });
  test("reused photo → contradicted", () => {
    expect(decide(p, tree, { planting: 1 }, { ...ctx, duplicatePhoto: true }).outcome).toBe("contradicted");
  });
  test("possible AI-generated photo → unresolved", () => {
    expect(decide(p, obs(tree.answers, { possibly_ai_generated_or_edited: true }), { planting: 1 }, ctx).outcome).toBe("unresolved");
  });
  test("no location → unresolved", () => {
    expect(decide(p, tree, { planting: 1 }, { ...ctx, hasLocation: false }).outcome).toBe("unresolved");
  });
});

describe("tree survival", () => {
  const p = PROTOCOLS.tree_survival;
  const ok = obs({ same_site: "yes", tree_alive: "yes" });
  test("alive at same spot after 30 days pays 400", () => {
    expect(decide(p, ok, { survival: 1 }, { ...ctx, daysSinceParent: 31, distanceFromParentM: 12 }).reward).toBe(400);
  });
  test("too far from the original → contradicted", () => {
    const d = decide(p, ok, { survival: 1 }, { ...ctx, daysSinceParent: 31, distanceFromParentM: 900 });
    expect(d.outcome).toBe("contradicted");
    expect(d.reasons[0]).toContain("900 m");
  });
  test("too early → unresolved", () => {
    expect(decide(p, ok, { survival: 1 }, { ...ctx, daysSinceParent: 3, distanceFromParentM: 5 }).outcome).toBe("unresolved");
  });
  test("dead tree → contradicted", () => {
    expect(decide(p, obs({ same_site: "yes", tree_alive: "no" }), { survival: 1 }, { ...ctx, daysSinceParent: 30, distanceFromParentM: 5 }).outcome).toBe("contradicted");
  });
});

describe("cleanup and recycling scale with SAM counts", () => {
  test("cleanup pays 50 + 10 per item removed, capped at 300", () => {
    const ok = obs({ same_place: "yes", visibly_cleaner: "yes" });
    expect(decide(PROTOCOLS.cleanup, ok, { before: 12, after: 2 }, ctx).reward).toBe(150);
    expect(decide(PROTOCOLS.cleanup, ok, { before: 80, after: 0 }, ctx).reward).toBe(300);
  });
  test("cleanup with no less litter → unresolved", () => {
    const ok = obs({ same_place: "yes", visibly_cleaner: "yes" });
    expect(decide(PROTOCOLS.cleanup, ok, { before: 5, after: 5 }, ctx).outcome).toBe("unresolved");
  });
  test("recycling pays 5 per item, capped at 200", () => {
    const ok = obs({ recyclables_visible: "yes", collected_not_in_shop: "yes" });
    expect(decide(PROTOCOLS.recycling, ok, { items: 9 }, ctx).reward).toBe(45);
    expect(decide(PROTOCOLS.recycling, ok, { items: 100 }, ctx).reward).toBe(200);
  });
});

test("haversine", () => {
  expect(Math.round(haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }))).toBe(111);
});
