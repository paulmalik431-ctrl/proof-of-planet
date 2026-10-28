import { expect, spyOn, test } from "bun:test";
import { BASETEN_BASE, MetaClient, MODELS, stripReasoning } from "../supabase/functions/_core/meta.ts";
import { MemoryStore } from "../supabase/functions/_core/store.ts";
import { verifyClaim } from "../supabase/functions/_core/verify.ts";
import { png, YES_TREE } from "./fake-meta.ts";

test("Muse Spark Open on Baseten: chat goes to Baseten with the hackathon model; no SAM; counts from the model", async () => {
  const calls: Array<{ url: string; model: string; auth: string }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url, model: body.model, auth: (init?.headers as Record<string, string>).Authorization });
    const obs = { ...YES_TREE, visible_counts: { planting: 1 } };
    return Response.json({ choices: [{ message: { role: "assistant", content: `<think>looking…</think>Here you go: ${JSON.stringify(obs)}` }, finish_reason: "stop" }] });
  }) as unknown as typeof fetch;
  const meta = new MetaClient(null, { fetch: f, chat: { base: BASETEN_BASE, key: "bt-key", model: MODELS.sparkOpen, label: "Muse Spark Open (Baseten)" } });
  const observed: unknown[] = [];
  meta.onCall = (event) => observed.push(event);
  expect(meta.canSegment).toBe(false);

  const store = new MemoryStore();
  const a = await store.createAccount("1");
  const c = await store.createClaim({ account_id: a.id, protocol: "tree_planting", parent_id: null, lat: 1, lng: 1 });
  await store.addEvidence({ claim_id: c.id, account_id: a.id, kind: "photo", role: "planting", path: await store.savePhoto(png(1), "image/png"), sha256: "x", lat: null, lng: null, text: null });
  const r = await verifyClaim(meta, store, c.id, new Date());

  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({ url: `${BASETEN_BASE}/chat/completions`, model: "meta-models/muse-spark-open-1026", auth: "Bearer bt-key" });
  expect(r.check.decision.outcome).toBe("consistent");
  expect(r.check.counts).toEqual({ planting: 1 });
  expect(r.check.models.reasoning).toBe("meta-models/muse-spark-open-1026");
  expect(r.check.models.trace).toMatchObject([{ model: MODELS.sparkOpen, endpoint: "/chat/completions", ok: true }]);
  expect(observed).toHaveLength(1);
  expect(r.credit?.amount).toBe(100);
});

test("reasoning text is stripped and SAM refuses without a Meta key", async () => {
  expect(stripReasoning("<think>a\nb</think> hi")).toBe("hi");
  const meta = new MetaClient(null, { chat: { base: BASETEN_BASE, key: "k", model: MODELS.sparkOpen, label: "x" } });
  await expect(meta.segment("data:,", "sapling")).rejects.toThrow("MODEL_API_KEY");
  expect(() => new MetaClient(null)).toThrow();
});

test("empty SAM SSE text logs a bounded raw response sample", async () => {
  const raw = `event: response.created\ndata: {"type":"response.created"}\n\n`;
  const log = spyOn(console, "log").mockImplementation(() => {});
  const f = (async () => new Response(raw, { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
  try {
    const meta = new MetaClient("test-key", { fetch: f });
    expect(await meta.segment("data:,image", "sapling")).toBe("");
    expect(log).toHaveBeenCalledWith("sam_sse_empty", JSON.stringify({ prompt: "sapling", content_type: "text/event-stream", raw }));
  } finally {
    log.mockRestore();
  }
});