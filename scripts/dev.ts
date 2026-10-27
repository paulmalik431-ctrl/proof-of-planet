// Local server: the web pages + the simulator agent + a small in-memory stand-in for Supabase
// (REST views, storage, functions). Uses the real Meta Model API when MODEL_API_KEY is set.
//   MODEL_API_KEY=... bun scripts/dev.ts            → http://localhost:8787
//   bun scripts/dev.ts --seed a.jpg b.jpg c.jpg     → also plays a scripted earn → trade → spend story (fake model answers)
import { handle, type Inbound } from "../supabase/functions/_core/agent.ts";
import { base64ToBytes, clientFromEnv } from "../supabase/functions/_core/meta.ts";
import { MemoryStore } from "../supabase/functions/_core/store.ts";
import { sha256Hex, SYSTEM } from "../supabase/functions/_core/ledger.ts";
import { fakeMeta, type Turn } from "../tests/fake-meta.ts";

const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = `http://localhost:${PORT}`;
const store = new MemoryStore();
const meta = process.env.MODEL_API_KEY || process.env.BASETEN_API_KEY ? clientFromEnv((k) => process.env[k]) : null;
if (meta) meta.onCall = (e) => console.log("meta", e);
const isSandbox = (p: string) => p.startsWith("999");
const deps = (m = meta!) => ({ store, meta: m, publicUrl: ORIGIN, limits: { messagesPerDay: 500, verificationsPerDay: 100 }, isSandbox });

const seedIdx = process.argv.indexOf("--seed");
if (seedIdx > 0) await seed(process.argv.slice(seedIdx + 1, seedIdx + 4));

async function seed(files: string[]) {
  const img = async (f: string) => ({ bytes: new Uint8Array(await Bun.file(f).arrayBuffer()), mime: "image/jpeg" });
  const T = (name: string, args: Record<string, unknown> = {}): Turn => ({ tools: [[name, args]] });
  const say = (text: string): Turn => ({ text });
  const tid = () => store.trades[0].id.slice(0, 6);
  const { meta: fm } = fakeMeta({
    sam: { sapling: 1, "plastic bottle": 120 },
    observation: { answers: { young_tree_in_ground: "yes", recently_planted: "yes", potted_or_indoor: "no" }, possibly_ai_generated_or_edited: false, confidence: 0.92, notes: "A young tree being planted in freshly dug soil.", better_evidence: "" },
    json: { lot_observation: { material_matches: "yes", sorted_and_clean: "yes", estimated_quantity: 120, possibly_ai_generated_or_edited: false, confidence: 0.88, notes: "Sorted clear PET bottles in bags." } },
    agent: [
      T("start_action", { action: "tree_planting" }), say("Send a photo."), say("Location?"), T("verify_claim"), say("Verified: +100 ECOIN."),
      T("sell_waste", { material: "pet_bottles", quantity: 120 }), say("Photo?"), say("Location?"), T("publish_listing"), say("Listed."),
      T("register_business", { name: "GreenCycle Recyclers" }), say("ok"), T("top_up_test_ecoin"), say("ok"), say("ok"),
      T("buy_waste", { material: "pet_bottles", quantity: 1000, max_price: 3 }), say("Offer found."),
      () => T("accept_offer", { trade_id: tid() }), say("Escrowed."),
      say("Got the delivery photo."),
      () => T("mark_delivered", { trade_id: tid() }), say("Buyer notified."),
      () => T("confirm_delivery", { trade_id: tid() }), say("Released."),
      T("register_shop", { name: "Mama Mboga Grocers" }), say("ok"),
      () => T("charge_customer", { phone: store.accounts.find((a) => a.phone === "999000000001")!.phone, amount: 120 }), say("Code sent."),
    ],
  });
  const d = deps(fm);
  let n = 0;
  const at = new Date();
  const m = (from: string, x: Partial<Inbound>): Promise<string[]> => handle(d, { id: `seed${++n}`, from, at, kind: "text", ...x });
  const P = "999000000001", B = "999000000002", S = "999000000003";
  for (const p of [P, B, S]) await m(p, { text: "yes" });
  await m(P, { text: "I planted a tree" });
  await m(P, { kind: "image", image: await img(files[0]) });
  await m(P, { kind: "location", location: { lat: -1.2921, lng: 36.8219 } });
  await m(P, { text: "I have 120 bottles to sell" });
  await m(P, { kind: "image", image: await img(files[1]) });
  await m(P, { kind: "location", location: { lat: -1.2862, lng: 36.8172 } });
  await m(B, { text: "We are GreenCycle Recyclers" });
  await m(B, { text: "top up" });
  await m(B, { kind: "location", location: { lat: -1.3032, lng: 36.8442 } });
  await m(B, { text: "buy 1000 PET bottles up to 3 each" });
  await m(B, { text: `accept ${tid()}` });
  await m(P, { kind: "image", image: await img(files[2] ?? files[1]) });
  await m(P, { text: `delivered ${tid()}` });
  await m(B, { text: `confirm ${tid()}` });
  await m(S, { text: "I run Mama Mboga Grocers" });
  await m(S, { text: `charge ${P} 120` });
  const code = /\*(\d{6})\*/.exec((await store.drain(store.accounts.find((a) => a.phone === P)!.id)).join())?.[1];
  if (code) await m(S, { text: code });
  store.outbox = [];
  store.sessions.clear();
  console.log(`seeded: ${store.claims.length} claim, ${store.trades.length} trade, ${store.payments.length} payment, ${store.ledger.length} ledger entries`);
}

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
const visible = new Set(["consistent", "unresolved", "contradicted"]);
const round = (x: number | null, d: number) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const bal = (a: string) => sum(store.ledger.filter((e) => e.account_id === a).map((e) => e.amount));

function view(name: string): Record<string, unknown>[] {
  const pub = store.claims.filter((c) => visible.has(c.status));
  const ids = new Set(pub.map((c) => c.id));
  const named = (id: string) => { const a = store.accounts.find((x) => x.id === id); return a && (a.roles.includes("business") || a.roles.includes("shop") || a.phone.startsWith("system:")) ? a.name : null; };
  switch (name) {
    case "public_accounts": return store.accounts.map((a) => ({ id: a.id, name: named(a.id), roles: a.roles, created_at: a.created_at }));
    case "public_claims": return pub.map((c) => ({ ...c, lat: round(c.lat, 4), lng: round(c.lng, 4) }));
    case "public_evidence": return store.evidence.filter((e) => e.kind === "photo" && !e.superseded && e.claim_id && ids.has(e.claim_id)).map(({ claim_id, role, path, sha256, created_at }) => ({ claim_id, role, path, sha256, created_at }));
    case "public_checks": return store.checks.filter((k) => ids.has(k.claim_id)) as never;
    case "public_listings": return store.listings.filter((l) => l.status !== "draft").map((l) => ({ ...l, photo_sha256: undefined, lat: round(l.lat, 2), lng: round(l.lng, 2) }));
    case "public_trades": return store.trades.map((t) => ({ ...t, buyer_name: named(t.buyer), dispute_reason: t.dispute?.reason ?? null, dispute: undefined }));
    case "public_ledger": return store.ledger as never;
    case "public_stats": {
      const ok = (p?: string) => store.claims.filter((c) => c.status === "consistent" && (!p || c.protocol === p)).length;
      const done = store.trades.filter((t) => t.status === "released" || t.status === "settled");
      return [{ verified_actions: ok(), trees_planted: ok("tree_planting"), trees_alive_30d: ok("tree_survival"), cleanups: ok("cleanup"),
        claims_not_paid: store.claims.filter((c) => c.status === "unresolved" || c.status === "contradicted").length,
        units_traded: sum(done.map((t) => t.quantity)), trades_completed: done.length, payments: store.payments.filter((p) => p.status === "paid").length,
        ecoin_minted: sum(store.ledger.filter((e) => e.kind === "reward").map((e) => e.amount)), reserve: bal(SYSTEM.reserve), fee_revenue: bal(SYSTEM.treasury), in_escrow: bal(SYSTEM.escrow),
        people_paid: new Set(store.ledger.filter((e) => e.kind === "reward").map((e) => e.account_id)).size }];
    }
    case "public_atlas": {
      const cells = new Map<string, Record<string, number>>();
      const key = (lat: number, lng: number) => `${(Math.floor(lat / 0.05) * 0.05 + 0.025).toFixed(3)},${(Math.floor(lng / 0.05) * 0.05 + 0.025).toFixed(3)}`;
      for (const c of pub) {
        if (c.lat === null) continue;
        const k = key(c.lat, c.lng!);
        const x = cells.get(k) ?? { verified: 0, trees: 0, trees_alive: 0, cleanups: 0, recycling: 0, held_back: 0, ecoin: 0, units_traded: 0 };
        if (c.status === "consistent") { x.verified++; x.ecoin += c.reward; if (c.protocol === "tree_planting") x.trees++; if (c.protocol === "tree_survival") x.trees_alive++; if (c.protocol === "cleanup") x.cleanups++; if (c.protocol === "recycling") x.recycling++; } else x.held_back++;
        cells.set(k, x);
      }
      for (const l of store.listings.filter((x) => x.status === "sold" && x.lat !== null)) {
        const k = key(l.lat!, l.lng!);
        const x = cells.get(k) ?? { verified: 0, trees: 0, trees_alive: 0, cleanups: 0, recycling: 0, held_back: 0, ecoin: 0, units_traded: 0 };
        x.units_traded += l.quantity;
        cells.set(k, x);
      }
      return [...cells].map(([k, x]) => ({ lat: Number(k.split(",")[0]), lng: Number(k.split(",")[1]), ...x, integrity: x.verified + x.held_back ? Math.round((x.verified / (x.verified + x.held_back)) * 100) / 100 : null }));
    }
  }
  return [];
}

/** The PostgREST subset the pages use: col=eq.value, col=in.(a,b), order=col[.desc], limit. */
function query(rows: Record<string, unknown>[], params: URLSearchParams) {
  let out = rows;
  for (const [k, v] of params) {
    if (v.startsWith("eq.")) out = out.filter((r) => String(r[k]) === v.slice(3));
    if (v.startsWith("in.(")) { const set = new Set(v.slice(4, -1).split(",")); out = out.filter((r) => set.has(String(r[k]))); }
  }
  const order = params.get("order");
  if (order) { const [col, dir] = order.split("."); out = [...out].sort((a, b) => (Number(a[col]) - Number(b[col]) || (String(a[col]) < String(b[col]) ? -1 : 1)) * (dir === "desc" ? -1 : 1)); }
  return out.slice(0, Number(params.get("limit") ?? 10000));
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
    if (url.pathname === "/config.js") return new Response(`export const SUPABASE_URL = "${ORIGIN}"; export const SUPABASE_ANON_KEY = "local"; export const WHATSAPP_NUMBER = ""; export const REPO_URL = "https://github.com/paulmalik431-ctrl/proof-of-planet";`, { headers: { "Content-Type": "text/javascript" } });
    if (url.pathname.startsWith("/rest/v1/")) return json(query(view(url.pathname.slice(9)), url.searchParams));
    if (url.pathname.startsWith("/storage/v1/object/public/evidence/")) {
      const p = store.photos.get(decodeURIComponent(url.pathname.slice(35)));
      return p ? new Response(p.bytes, { headers: { "Content-Type": p.mime } }) : new Response("not found", { status: 404 });
    }
    if (url.pathname === "/functions/v1/atlas") return json({ brief: null, cells: view("public_atlas"), stats: view("public_stats")[0] });
    if (url.pathname === "/functions/v1/simulate" && req.method === "POST") {
      const b = await req.json();
      const persona = ["person", "business", "shop", "reviewer"].includes(b.persona) ? b.persona : "person";
      const phone = "999" + (BigInt("0x" + (await sha256Hex(`${b.session}:${persona}`)).slice(0, 12)) % 1_000_000_000n).toString().padStart(9, "0");
      const acct = () => store.accountByPhone(phone);
      if (b.poll) { const a = await acct(); return json({ replies: [], inbox: a ? await store.drain(a.id) : [], phone }); }
      if (!meta) return json({ replies: ["Set MODEL_API_KEY or BASETEN_API_KEY to talk to the live agent locally."], inbox: [], phone });
      const base = { id: `sim_${crypto.randomUUID()}`, from: phone, at: new Date() };
      const msg: Inbound = b.image ? { ...base, kind: "image", image: { bytes: base64ToBytes(b.image), mime: b.mime ?? "image/jpeg", caption: b.text } }
        : typeof b.lat === "number" ? { ...base, kind: "location", location: { lat: b.lat, lng: b.lng } }
        : { ...base, kind: "text", text: String(b.text ?? "") };
      try {
        const replies = await handle(deps(), msg);
        const a = await acct();
        if (a && persona === "reviewer" && a.consent_at && !a.roles.includes("ops")) await store.updateAccount(a.id, { roles: [...a.roles, "ops"] });
        return json({ replies, inbox: a ? await store.drain(a.id) : [], phone });
      } catch (e) { console.error(e); return json({ replies: [`Error: ${String(e)}`], inbox: [], phone }); }
    }
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const f = Bun.file(`${import.meta.dir}/../web${path}`);
    return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
  },
});
console.log(`ECO local: ${ORIGIN}  (Meta API: ${meta ? "live" : "off"})`);
