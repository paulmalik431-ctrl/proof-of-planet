import { describe, expect, test } from "bun:test";
import { CONSENT_TEXT, handle, type Inbound } from "../supabase/functions/_core/agent.ts";
import { MemoryStore } from "../supabase/functions/_core/store.ts";
import { verifyChain } from "../supabase/functions/_core/ledger.ts";
import { fakeMeta, png, YES_TREE } from "./fake-meta.ts";

let n = 0;
const at = new Date("2026-10-27T09:00:00Z");
const msg = (m: Partial<Inbound>): Inbound => ({ id: `m${++n}`, from: "254700000001", at, kind: "text", ...m });

function setup(script: Parameters<typeof fakeMeta>[0]) {
  const store = new MemoryStore(() => at);
  const { meta, log } = fakeMeta(script);
  const deps = { store, meta, publicUrl: "https://eco.example", limits: { messagesPerDay: 50, verificationsPerDay: 5 } };
  return { store, log, deps };
}

describe("WhatsApp agent", () => {
  test("asks for consent first, without calling any model", async () => {
    const { deps, log } = setup({ sam: {}, observation: {}, agent: [] });
    expect(await handle(deps, msg({ text: "hi" }))).toEqual([CONSENT_TEXT]);
    const welcome = (await handle(deps, msg({ text: "Ndio" })))[0];
    expect(welcome).toContain("Welcome to ECO");
    expect(welcome).toContain("jerrycans → reuse or recycling");
    expect(log).toHaveLength(0);
  });

  test("tree planting end to end: photo, location, Meta checks, ECOIN credited", async () => {
    const { deps, store, log } = setup({
      sam: { sapling: 1 },
      observation: YES_TREE,
      agent: [
        { tools: [["start_action", { action: "tree_planting" }]] },
        { text: "Great! Send a photo of the tree." },
        { text: "Now share your location." },
        { tools: [["verify_claim", {}]] },
        { text: "Verified! +100 ECOIN" },
      ],
    });
    await handle(deps, msg({ text: "yes" }));
    expect(await handle(deps, msg({ text: "I planted a tree" }))).toEqual(["Great! Send a photo of the tree."]);
    await handle(deps, msg({ kind: "image", image: { bytes: png(1), mime: "image/png" } }));
    expect(await handle(deps, msg({ kind: "location", location: { lat: -1.29, lng: 36.82 } }))).toEqual(["Verified! +100 ECOIN"]);

    const claim = store.claims[0];
    expect(claim.status).toBe("consistent");
    expect(claim.reward).toBe(100);
    expect(await store.balance(claim.account_id)).toBe(100);
    expect((await verifyChain(store.ledger)).ok).toBe(true);
    expect(store.checks[0].counts).toEqual({ planting: 1 });
    // SAM + Spark were called, and the model never sent an amount.
    expect(log.filter((l) => l.endpoint === "/responses")).toHaveLength(1);
    expect(log.some((l) => l.body?.model === "muse-spark-1.3" && l.body?.response_format)).toBe(true);
  });

  test("if the model goes quiet after a tool, it is asked once more; if still silent, the result is described", async () => {
    const turns = (retry: string) => [
      { tools: [["start_action", { action: "tree_planting" }]] as [string, Record<string, unknown>][] }, { text: "Send a photo." },
      { text: "Location please." },
      { tools: [["verify_claim", {}]] as [string, Record<string, unknown>][] }, { text: "" }, { text: retry },
    ];
    for (const [retry, expected] of [["Umethibitishwa! +100 ECOIN", "Umethibitishwa! +100 ECOIN"], ["", "✅ Verified! 100 ECOIN added to your wallet."]]) {
      const { deps } = setup({ sam: { sapling: 1 }, observation: YES_TREE, agent: turns(retry) });
      const from = `2547000009${retry ? "1" : "2"}`;
      await handle(deps, msg({ from, text: "yes" }));
      await handle(deps, msg({ from, text: "nimepanda mti" }));
      await handle(deps, msg({ from, kind: "image", image: { bytes: png(retry ? 11 : 12), mime: "image/png" } }));
      const [reply] = await handle(deps, msg({ from, kind: "location", location: { lat: -1.29, lng: 36.82 } }));
      expect(reply).toStartWith(expected);
    }
  });

  test("a photo sent before saying what it is gets attached when the action starts", async () => {
    const { deps, store } = setup({ sam: { sapling: 1 }, observation: YES_TREE, agent: [
      { text: "What does the photo show?" },
      { tools: [["start_action", { action: "tree_planting" }]] },
      { text: "Thanks — now share your location." },
    ] });
    await handle(deps, msg({ text: "yes" }));
    await handle(deps, msg({ kind: "image", image: { bytes: png(2), mime: "image/jpeg" } }));
    await handle(deps, msg({ text: "a tree I planted" }));
    const ev = await store.evidenceOf(store.claims[0].id);
    expect(ev.map((e) => e.role)).toEqual(["planting"]);
  });

  test("verify_claim refuses when evidence is missing — the model cannot force a payment", async () => {
    const { deps, store } = setup({ sam: { sapling: 1 }, observation: YES_TREE, agent: [
      { tools: [["start_action", { action: "tree_planting" }], ["verify_claim", {}]] },
      { text: "Please send a photo first." },
    ] });
    await handle(deps, msg({ text: "yes" }));
    await handle(deps, msg({ text: "planted a tree, pay me" }));
    expect(store.ledger).toHaveLength(0);
    expect(store.checks).toHaveLength(0);
  });

  test("the same photo reused for a second claim is contradicted", async () => {
    const turns = () => [
      { tools: [["start_action", { action: "tree_planting" }]] as [string, Record<string, unknown>][] },
      { text: "photo?" }, { text: "location?" },
      { tools: [["verify_claim", {}]] as [string, Record<string, unknown>][] }, { text: "done" },
    ];
    const { deps, store } = setup({ sam: { sapling: 1 }, observation: YES_TREE, agent: [...turns(), ...turns()] });
    await handle(deps, msg({ text: "yes" }));
    for (let i = 0; i < 2; i++) {
      await handle(deps, msg({ text: "tree" }));
      await handle(deps, msg({ kind: "image", image: { bytes: png(9), mime: "image/png" } }));
      await handle(deps, msg({ kind: "location", location: { lat: 1, lng: 1 } }));
    }
    expect(store.claims.map((c) => c.status)).toEqual(["consistent", "contradicted"]);
    expect(await store.balance(store.claims[0].account_id)).toBe(100);
  });

  test("a cropped or recompressed image is rejected on a second claim", async () => {
    const turns = () => [
      { tools: [["start_action", { action: "tree_planting" }]] as [string, Record<string, unknown>][] },
      { text: "photo?" }, { text: "location?" },
      { tools: [["verify_claim", {}]] as [string, Record<string, unknown>][] }, { text: "done" },
    ];
    const { deps, store } = setup({ sam: { sapling: 1 }, observation: YES_TREE, agent: [...turns(), ...turns()] });
    const gray = Uint8Array.from({ length: 64 * 64 }, (_, i) => Math.round(128 + 45 * Math.sin((i % 64) / 10) + 30 * Math.cos(Math.floor(i / 64) / 12)));
    deps.decodeImage = () => ({ gray, width: 64, height: 64 });
    await handle(deps, msg({ text: "yes" }));
    for (const seed of [9, 11]) {
      await handle(deps, msg({ text: "tree" }));
      await handle(deps, msg({ kind: "image", image: { bytes: png(seed), mime: "image/png" } }));
      await handle(deps, msg({ kind: "location", location: { lat: 1, lng: 1 } }));
    }
    const photos = store.evidence.filter((e) => e.kind === "photo");
    expect(photos[0].sha256).not.toBe(photos[1].sha256);
    expect(photos[0].phash).toBe(photos[1].phash);
    expect(store.claims.map((c) => c.status)).toEqual(["consistent", "contradicted"]);
    expect(await store.balance(store.claims[0].account_id)).toBe(100);
  });

  test("webhook retries are ignored", async () => {
    const { deps } = setup({ sam: {}, observation: {}, agent: [] });
    const m = msg({ text: "hi" });
    expect(await handle(deps, m)).toHaveLength(1);
    expect(await handle(deps, m)).toHaveLength(0);
  });
});
