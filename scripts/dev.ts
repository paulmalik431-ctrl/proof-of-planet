// Local server: the web pages + the simulator agent + a tiny stand-in for Supabase's REST,
// storage and functions, all in memory. Uses the real Meta Model API when MODEL_API_KEY is set.
//   MODEL_API_KEY=... bun scripts/dev.ts        → http://localhost:8787
//   bun scripts/dev.ts --seed photo.jpg         → also adds one verified demo claim (fake model answers)
import { handle } from "../supabase/functions/_core/agent.ts";
import { base64ToBytes, MetaClient } from "../supabase/functions/_core/meta.ts";
import { MemoryStore } from "../supabase/functions/_core/store.ts";
import { verifyClaim } from "../supabase/functions/_core/verify.ts";
import { sha256Hex } from "../supabase/functions/_core/ledger.ts";
import { fakeMeta, YES_TREE } from "../tests/fake-meta.ts";

const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = `http://localhost:${PORT}`;
const store = new MemoryStore();
const meta = process.env.MODEL_API_KEY ? new MetaClient(process.env.MODEL_API_KEY) : null;
if (meta) meta.onCall = (e) => console.log("meta", e);
const deps = () => ({ store, meta: meta!, publicUrl: ORIGIN, limits: { messagesPerDay: 200, verificationsPerDay: 50 } });

const seedIdx = process.argv.indexOf("--seed");
if (seedIdx > 0) {
  const file = Bun.file(process.argv[seedIdx + 1]);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const acct = await store.createAccount("seed");
  await store.setConsent(acct.id, new Date().toISOString());
  const claim = await store.createClaim({ account_id: acct.id, protocol: "tree_planting", parent_id: null, lat: -1.2921, lng: 36.8219 });
  await store.addEvidence({ claim_id: claim.id, account_id: acct.id, kind: "photo", role: "planting", path: await store.savePhoto(bytes, file.type || "image/jpeg"), sha256: await sha256Hex(bytes), lat: null, lng: null, text: null });
  const { meta: fm } = fakeMeta({ sam: { sapling: 1 }, observation: YES_TREE, agent: [] });
  await verifyClaim(fm, store, claim.id, new Date());
  await store.appendLedger({ account_id: "eco_demo00000001", amount: 45, kind: "reward", claim_id: null, memo: "Recycling drop-off" }).catch(() => undefined);
  console.log(`seeded: ${ORIGIN}/claim.html?id=${claim.id}`);
}

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
const visible = new Set(["consistent", "unresolved", "contradicted"]);

function view(name: string): Record<string, unknown>[] {
  const pub = store.claims.filter((c) => visible.has(c.status));
  const ids = new Set(pub.map((c) => c.id));
  switch (name) {
    case "public_claims": return pub.map(({ lat, lng, ...c }) => ({ ...c, lat: lat === null ? null : Math.round(lat * 1e4) / 1e4, lng: lng === null ? null : Math.round(lng * 1e4) / 1e4 }));
    case "public_evidence": return store.evidence.filter((e) => e.kind === "photo" && !e.superseded && e.claim_id && ids.has(e.claim_id)).map(({ claim_id, role, path, sha256, created_at }) => ({ claim_id, role, path, sha256, created_at }));
    case "public_checks": return store.checks.filter((k) => ids.has(k.claim_id)) as unknown as Record<string, unknown>[];
    case "public_ledger": return store.ledger as unknown as Record<string, unknown>[];
    case "public_stats": {
      const ok = (p?: string) => store.claims.filter((c) => c.status === "consistent" && (!p || c.protocol === p)).length;
      return [{ verified_actions: ok(), trees_planted: ok("tree_planting"), trees_alive_30d: ok("tree_survival"), cleanups: ok("cleanup"),
        items_recycled: store.checks.filter((k) => k.decision.outcome === "consistent").reduce((s, k) => s + (k.counts.items ?? 0), 0),
        claims_not_paid: store.claims.filter((c) => c.status === "unresolved" || c.status === "contradicted").length,
        ecoin_issued: store.ledger.reduce((s, e) => s + e.amount, 0), people_paid: new Set(store.ledger.map((e) => e.account_id)).size }];
    }
  }
  return [];
}

/** Supports the PostgREST subset the pages use: col=eq.value, order=col[.desc], limit. */
function query(rows: Record<string, unknown>[], params: URLSearchParams) {
  let out = rows;
  for (const [k, v] of params) if (v.startsWith("eq.")) out = out.filter((r) => String(r[k]) === v.slice(3));
  const order = params.get("order");
  if (order) {
    const [col, dir] = order.split(".");
    out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === "desc" ? -1 : 1));
  }
  return out.slice(0, Number(params.get("limit") ?? 10000));
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
    if (url.pathname === "/config.js") {
      return new Response(`export const SUPABASE_URL = "${ORIGIN}"; export const SUPABASE_ANON_KEY = "local"; export const WHATSAPP_NUMBER = ""; export const REPO_URL = "https://github.com/paulmalik431-ctrl/eco-climate-os";`, { headers: { "Content-Type": "text/javascript" } });
    }
    if (url.pathname.startsWith("/rest/v1/")) return json(query(view(url.pathname.slice(9)), url.searchParams));
    if (url.pathname.startsWith("/storage/v1/object/public/evidence/")) {
      const p = store.photos.get(decodeURIComponent(url.pathname.slice(35)));
      return p ? new Response(p.bytes, { headers: { "Content-Type": p.mime } }) : new Response("not found", { status: 404 });
    }
    if (url.pathname === "/functions/v1/simulate" && req.method === "POST") {
      if (!meta) return json({ replies: ["Set MODEL_API_KEY to talk to the live agent locally."] });
      const b = await req.json();
      const base = { id: `sim_${crypto.randomUUID()}`, from: `sim_${b.session}`, at: new Date() };
      const msg = b.image ? { ...base, kind: "image" as const, image: { bytes: base64ToBytes(b.image), mime: b.mime ?? "image/jpeg", caption: b.text } }
        : typeof b.lat === "number" ? { ...base, kind: "location" as const, location: { lat: b.lat, lng: b.lng } }
        : { ...base, kind: "text" as const, text: String(b.text ?? "") };
      try { return json({ replies: await handle(deps(), msg) }); } catch (e) { console.error(e); return json({ replies: [`Error: ${String(e)}`] }); }
    }
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const f = Bun.file(`${import.meta.dir}/../web${path}`);
    return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
  },
});
console.log(`ECO local: ${ORIGIN}  (Meta API: ${meta ? "live" : "off"})`);
