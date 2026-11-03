// Prints the live demo state from the public views (no secrets, no phone numbers).   bun scripts/status.ts
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../web/config.js";
const rest = async (p: string) => (await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } })).json();
const s = (id: string) => String(id).slice(0, 6);
console.log("CLAIMS");
for (const c of await rest("public_claims?select=id,protocol,status,reward,verified_at&order=created_at")) console.log(` #${s(c.id)} ${c.protocol} ${c.status} reward=${c.reward} ${c.verified_at?.slice(0, 16) ?? ""}`);
console.log("ADOPTIONS");
for (const a of await rest("public_adoptions?select=claim_id,business_name,amount,created_at")) console.log(` tree #${s(a.claim_id)} by ${a.business_name} ${a.amount} ECOIN ${a.created_at.slice(0, 16)}`);
console.log("LISTINGS");
for (const l of await rest("public_listings?select=id,material,quantity,unit,grade,status,created_at&order=created_at")) console.log(` #${s(l.id)} ${l.quantity} ${l.unit} ${l.material} grade=${l.grade} ${l.status} ${l.created_at.slice(0, 16)}`);
console.log("TRADES");
for (const t of await rest("public_trades?select=id,material,quantity,price,total,status,buyer_name,intake,created_at&order=created_at")) console.log(` #${s(t.id)} ${t.quantity} ${t.material} @${t.price}=${t.total} ${t.status} buyer=${t.buyer_name} accepted=${t.intake?.accepted_quantity ?? "-"}`);
console.log("ACCOUNTS (businesses)");
for (const a of await rest("public_accounts?select=id,name,roles&roles=cs.{business}")) console.log(` ${a.id} ${a.name}`);
