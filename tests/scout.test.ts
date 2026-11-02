import { describe, expect, test } from "bun:test";
import { adviseFromScout, type ScoutObservation } from "../supabase/functions/_core/scout.ts";
import { handle, type Inbound } from "../supabase/functions/_core/agent.ts";
import { MemoryStore } from "../supabase/functions/_core/store.ts";
import { fakeMeta, png } from "./fake-meta.ts";

const obs = (x: Partial<ScoutObservation>): ScoutObservation => ({
  category: "unclear", action: "none", material: "none", other_material: "", looks_usable: "yes",
  people_identifiable: false, possibly_ai_generated_or_edited: false, confidence: 0.9, notes: "", ...x,
});

describe("Scout: a photo with no context gets a next step, never a payment", () => {
  test("a planted tree starts a claim", () => {
    const a = adviseFromScout(obs({ category: "climate_action", action: "tree_planting" }), () => 0);
    expect(a.outcome).toBe("start_action");
    expect(a.protocol).toBe("tree_planting");
    expect(a.message).toContain("start_action");
  });
  test("cow dung is offered to farmers and biogas plants, with live bid count", () => {
    const a = adviseFromScout(obs({ category: "waste_lot", material: "cow_dung" }), () => 2);
    expect(a.outcome).toBe("offer_to_sell");
    expect(a.value_chains).toContain("organic manure");
    expect(a.buyers).toContain("farmers");
    expect(a.message).toContain("2 buyers are bidding");
    expect(a.message).toContain("one-time code"); // a listing still needs a fresh code photo
  });
  test("unknown useful waste gets honest advice, no buyer promised", () => {
    const a = adviseFromScout(obs({ category: "waste_lot", material: "other", other_material: "coconut husks" }), () => 0);
    expect(a.outcome).toBe("advise_only");
    expect(a.message).toContain("coconut husks");
    expect(a.message).toContain("do not promise a buyer");
  });
  test("AI-made, low-confidence or irrelevant photos are not used", () => {
    expect(adviseFromScout(obs({ category: "waste_lot", material: "cow_dung", possibly_ai_generated_or_edited: true }), () => 5).outcome).toBe("rejected");
    expect(adviseFromScout(obs({ category: "climate_action", action: "cleanup", confidence: 0.3 }), () => 0).outcome).toBe("advise_only");
    expect(adviseFromScout(obs({ category: "not_relevant", notes: "a selfie" }), () => 0).outcome).toBe("rejected");
  });

  test("agent: a photo sent with no words is identified and routed, nothing listed or paid", async () => {
    const store = new MemoryStore(() => new Date("2026-11-02T09:00:00Z"));
    const { meta } = fakeMeta({
      sam: {}, observation: {},
      json: { photo_scout: { category: "waste_lot", action: "none", material: "cow_dung", other_material: "", looks_usable: "yes", people_identifiable: false, possibly_ai_generated_or_edited: false, confidence: 0.92, notes: "A heap of dried cow dung beside a shed." } },
      agent: [(() => ({ text: "That's dried cow dung — farmers buy it as manure and biogas plants use it. How many kg do you have?" }))],
    });
    const deps = { store, meta, publicUrl: "https://eco.example", limits: { messagesPerDay: 50, verificationsPerDay: 5 } };
    let n = 0;
    const m = (x: Partial<Inbound>): Inbound => ({ id: `s${++n}`, from: "254700000077", at: new Date("2026-11-02T09:00:00Z"), kind: "text", ...x });
    await handle(deps, m({ text: "yes" }));
    const [reply] = await handle(deps, m({ kind: "image", image: { bytes: png(42), mime: "image/jpeg" } }));
    expect(reply).toContain("cow dung");
    const session = (await store.session((await store.accountByPhone("254700000077"))!.id))!;
    const filed = session.history.at(-2)!.content as string;
    expect(filed).toContain("Scout result: offer_to_sell");
    expect(store.listings).toHaveLength(0);
    expect(store.ledger).toHaveLength(0);
  });
});
