// Live smoke test of the deployed system. Read-only except for one sandbox seller session
// (999… numbers, same as the public web demo). Never creates bids, trades or ECOIN.
// Run: bun scripts/smoke.ts   (needs network; no secrets)
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../web/config.js";
import { verifyChain } from "../supabase/functions/_core/ledger.ts";

const SITE = "https://paulmalik431-ctrl.github.io/proof-of-planet";
const FN = `${SUPABASE_URL}/functions/v1`;
const results: { check: string; ok: boolean; detail: string }[] = [];
const record = (check: string, ok: boolean, detail = "") => {
  results.push({ check, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${check}${detail ? `  — ${detail}` : ""}`);
};
const safe = async (check: string, f: () => Promise<void>) => { try { await f(); } catch (e) { record(check, false, String(e).slice(0, 300)); } };
const rest = async (path: string) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};

// 1. Every page of the site loads.
for (const page of ["", "index.html", "try.html", "ledger.html", "atlas.html", "card.html", "claim.html", "listing.html", "trade.html", "intake.html", "privacy.html", "style.css", "app.js", "config.js", "js/ledger.js"]) {
  await safe(`site /${page}`, async () => {
    const r = await fetch(`${SITE}/${page}`);
    record(`site /${page}`, r.ok, String(r.status));
  });
}

// 2. Public data and the hash chain.
await safe("public_stats", async () => { const s = await rest("public_stats?select=*"); record("public_stats", Array.isArray(s), JSON.stringify(s).slice(0, 300)); });
await safe("ledger chain", async () => {
  const all = await rest("public_ledger?select=*&order=seq.asc&limit=10000");
  const v = await verifyChain(all);
  record("ledger chain", v.ok, `${all.length} entries${v.ok ? " intact" : ` broken at ${v.brokenAt}: ${v.reason}`}`);
});
await safe("trades", async () => {
  const t = await rest("public_trades?select=*");
  const by: Record<string, number> = {};
  for (const x of t) by[x.status] = (by[x.status] ?? 0) + 1;
  record("trades", true, `${t.length} trades by status ${JSON.stringify(by)}`);
});
await safe("listings", async () => { const l = await rest("public_listings?select=*"); record("listings", true, `${l.length} listings`); });
await safe("claims", async () => {
  const c = await rest("public_claims?select=*");
  const by: Record<string, number> = {};
  for (const x of c) by[x.status ?? x.result ?? "?"] = (by[x.status ?? x.result ?? "?"] ?? 0) + 1;
  record("claims", true, `${c.length} claims ${JSON.stringify(by)}`);
});

// 3. Functions.
await safe("atlas (Muse Spark Open)", async () => {
  const r = await fetch(`${FN}/atlas`); const j = await r.json();
  const model = JSON.stringify(j).match(/meta-models\/[a-z0-9-]+|muse-spark[a-z0-9.-]*/)?.[0] ?? "none";
  record("atlas (Muse Spark Open)", r.ok && /open/.test(model), `${r.status} model=${model}`);
});
await safe("whatsapp webhook rejects bad verify token", async () => {
  const r = await fetch(`${FN}/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`);
  record("whatsapp webhook rejects bad verify token", r.status === 403, String(r.status));
});
await safe("whatsapp webhook rejects unsigned POST", async () => {
  const r = await fetch(`${FN}/whatsapp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  record("whatsapp webhook rejects unsigned POST", r.status === 401 || r.status === 403, String(r.status));
});
await safe("wa-setup", async () => {
  const j = await (await fetch(`${FN}/wa-setup`)).json();
  const ok = j.check_waba_apps?.status === 200 && j.waba_subscribed_apps?.status === 200 && j.app_subscription?.status === 200;
  const num = j.phone_numbers?.data?.[0];
  record("wa-setup (webhook + permanent token)", ok, `waba ${j.check_waba_apps?.status}; number ${num?.display_phone_number ?? "?"} status=${num?.status ?? j.phone_numbers?.error ?? "?"} quality=${num?.quality_rating ?? "?"}`);
});
await safe("card rejects unknown id", async () => {
  const r = await fetch(`${FN}/card?trade=00000000-0000-0000-0000-000000000000`); const j = await r.json();
  record("card rejects unknown id", !!j.error && !j.path, `${r.status} ${j.error ?? ""}`);
});

// 4. Seller flow through the same agent as WhatsApp (sandbox number).
const session = `smoke${Date.now().toString(36)}`;
const say = async (body: Record<string, unknown>) => {
  const t0 = Date.now();
  const r = await fetch(`${FN}/simulate`, { method: "POST", headers: { "content-type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }, body: JSON.stringify({ session, persona: "person", ...body }) });
  const j = await r.json();
  const text = [...(j.replies ?? []), ...(j.inbox ?? []).map((m: unknown) => typeof m === "string" ? m : JSON.stringify(m))].join(" | ");
  console.log(`   [${((Date.now() - t0) / 1000).toFixed(1)}s] ${String(body.text ?? (body.image ? "<photo>" : "")).slice(0, 40)} → ${text.slice(0, 600).replace(/\n/g, " ")}`);
  return text;
};
await safe("seller: consent", async () => {
  const a = await say({ text: "Hi" });
  const b = await say({ text: "Yes" });
  record("seller: consent + welcome", /YES/.test(a) && /photo|ECOIN/i.test(b), "");
});
await safe("seller: photo scout (cow dung)", async () => {
  let img: Response | null = null;
  for (let i = 0; i < 4 && !img?.ok; i++) {
    if (i) await new Promise((r) => setTimeout(r, 8000 * i));
    img = await fetch("https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/Cow_Dung_Heap.jpg/960px-Cow_Dung_Heap.jpg", { headers: { "user-agent": "eco-proof-of-planet-smoke/1.0 (github.com/paulmalik431-ctrl/proof-of-planet)" } });
  }
  if (!img?.ok) { console.log(`SKIP  seller: photo scout — the sample photo host answered ${img?.status} (not our system)`); return; }
  const b64 = Buffer.from(await img.arrayBuffer()).toString("base64");
  const t = await say({ image: b64, mime: "image/jpeg" });
  record("seller: photo scout (cow dung)", /manure|farmer|compost|biogas|dung/i.test(t), "");
});
await safe("seller: start a sale", async () => {
  const t = await say({ text: "I want to sell 100 plastic bottles" });
  record("seller: start a sale (asks for code photo)", /Write \*?[A-Z0-9]{4,6}\*?|code/i.test(t), "");
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log("FAILED:"); for (const f of failed) console.log(` - ${f.check}: ${f.detail}`); process.exit(1); }
