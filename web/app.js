import { SUPABASE_URL, SUPABASE_ANON_KEY, WHATSAPP_NUMBER, REPO_URL } from "./config.js";

export const configured = !SUPABASE_URL.includes("YOUR-PROJECT");
export { WHATSAPP_NUMBER, REPO_URL };

export async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export async function fn(name, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `${res.status}`);
  return j;
}

export const photoUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/evidence/${path}`;

export const PROTOCOL_TITLES = { tree_planting: "Tree planting", tree_survival: "Tree survival check", cleanup: "Cleanup", recycling: "Recycling drop-off" };
export const OUTCOME_WORDS = { consistent: "Verified", unresolved: "Needs better evidence", contradicted: "Contradicted" };

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}

export const fmtDate = (s) => new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
export const short = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "");

export function nav() {
  const wa = WHATSAPP_NUMBER ? el("a", { href: `https://wa.me/${WHATSAPP_NUMBER}?text=Hi%20ECO` }, "WhatsApp") : null;
  return el("nav", { class: "top" }, el("div", { class: "wrap" },
    el("a", { class: "brand", href: "./" }, "ECO"),
    el("a", { href: "try.html" }, "Try it"),
    el("a", { href: "ledger.html" }, "Ledger"),
    wa,
    el("a", { href: REPO_URL }, "Code"),
  ));
}

export function notConfigured(target) {
  target.append(el("div", { class: "card" }, el("p", {}, "This page reads live data from ECO's database, which is not connected in this copy."), el("p", { class: "muted small" }, "Set SUPABASE_URL and SUPABASE_ANON_KEY in web/config.js.")));
}
