// Ghost Audit, server-side (the Meta key lives here): Muse Image generates fraudulent evidence and the production
// checks (SAM 3.1 + Muse Spark + fixed rules, and the Loop lot check) try to catch it. One case per request, cached,
// with a daily cap. GET ?case=<id>, ?case=replay, or no case for the list. Fakes are stored under ghost-audit/ in the
// public evidence bucket so anyone can look at what was attempted. Nothing here touches the ledger.
import { FAKES, LOT_CHALLENGE, LOT_FAKES } from "../_core/ghost.ts";
import { MemoryStore } from "../_core/store.ts";
import { verifyClaim } from "../_core/verify.ts";
import { assessLot, MATERIALS } from "../_core/loop.ts";
import { bytesToDataUrl } from "../_core/meta.ts";
import { sha256Hex } from "../_core/ledger.ts";
import { cors, env, json, makeDeps } from "../_shared/deps.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const id = new URL(req.url).searchParams.get("case");
  const ids = [...FAKES.map((f) => f.id), ...LOT_FAKES.map((f) => f.id), "replay"];
  if (!id) return json({ cases: ids });
  if (!ids.includes(id)) return json({ error: "unknown case" }, 400);
  const deps = makeDeps({ messagesPerDay: 0, verificationsPerDay: 0 });
  const { store, meta } = deps;
  const kind = `ghost:${id}`;
  const { data: cached } = await store.db.from("briefs").select("body").eq("kind", kind).limit(1).maybeSingle();
  if (cached) return json({ ...cached.body, cached: true });
  if ((await store.bump("ghost_audit")) > Number(env("GHOST_DAILY_CAP", "40"))) return json({ error: "daily cap reached" }, 429);

  const image = async (name: string, prompt: string) => {
    const path = `ghost-audit/${name}.png`;
    const got = await store.db.storage.from("evidence").download(path);
    if (got.data) return { path, bytes: new Uint8Array(await got.data.arrayBuffer()) };
    const bytes = await meta.generateImage(prompt);
    await store.db.storage.from("evidence").upload(path, bytes, { contentType: "image/png", upsert: true });
    return { path, bytes };
  };
  const claimRun = async (mem: MemoryStore, protocol: typeof FAKES[number]["protocol"], photos: Record<string, Uint8Array>, who: string) => {
    const acct = await mem.createAccount(`audit-${who}`);
    const claim = await mem.createClaim({ account_id: acct.id, protocol, parent_id: null, lat: -1.29, lng: 36.82 });
    for (const [role, bytes] of Object.entries(photos)) {
      await mem.addEvidence({ claim_id: claim.id, account_id: acct.id, kind: "photo", role, path: await mem.savePhoto(bytes, "image/png"), sha256: await sha256Hex(bytes), lat: null, lng: null, text: null });
    }
    const r = await verifyClaim(meta, mem, claim.id, new Date());
    return { outcome: r.check.decision.outcome, reasons: r.check.decision.reasons, ai_flag: r.check.observation.possibly_ai_generated_or_edited, notes: r.check.observation.notes, counts: r.check.counts };
  };

  let body: Record<string, unknown>;
  try {
    const f = FAKES.find((x) => x.id === id);
    const lot = LOT_FAKES.find((x) => x.id === id);
    if (f) {
      const photos: Record<string, Uint8Array> = {}, paths: string[] = [];
      for (const [role, prompt] of Object.entries(f.prompts)) { const im = await image(`${f.id}-${role}`, prompt); photos[role] = im.bytes; paths.push(im.path); }
      const r = await claimRun(new MemoryStore(), f.protocol, photos, f.id);
      body = { id, type: "claim", protocol: f.protocol, note: f.note, images: paths, ...r, paid: r.outcome === "consistent" };
    } else if (lot) {
      const im = await image(lot.id, lot.prompt);
      const a = await assessLot(meta, MATERIALS.plastic_jerrycans, 20, bytesToDataUrl(im.bytes, "image/png"), LOT_CHALLENGE);
      body = { id, type: "lot", note: lot.note, challenge: LOT_CHALLENGE, images: [im.path], outcome: a.outcome, reasons: a.reasons, notes: a.observation.notes, ai_flag: a.observation.possibly_ai_generated_or_edited, paid: a.outcome === "listed" };
    } else {
      // Replay: the same image submitted as two claims. The second must never pay.
      const im = await image("ai-sapling-1-planting", FAKES[0].prompts.planting);
      const mem = new MemoryStore();
      const first = await claimRun(mem, "tree_planting", { planting: im.bytes }, "replay-a");
      const second = await claimRun(mem, "tree_planting", { planting: im.bytes }, "replay-b");
      body = { id, type: "claim", protocol: "tree_planting", note: "Same photo submitted again as a new claim", images: [im.path], first: first.outcome, ...second, paid: second.outcome === "consistent" };
    }
  } catch (e) {
    console.error("ghost audit failed", id, String(e));
    return json({ id, error: String(e).slice(0, 300) }, 500);
  }
  await store.db.from("briefs").insert({ kind, body });
  return json(body);
});
