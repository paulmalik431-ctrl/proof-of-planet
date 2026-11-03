// Replays a WhatsApp-style conversation through the deployed simulator (sandbox number) and prints every reply.
//   bun scripts/repro.ts "Hello" "Yes" "3" "We are JAO Industries"
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../web/config.js";
const session = `repro${Date.now().toString(36)}`;
for (const text of process.argv.slice(2)) {
  const t0 = Date.now();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/simulate`, { method: "POST", headers: { "content-type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }, body: JSON.stringify({ session, persona: "business", text }) });
  const j = await r.json();
  console.log(`\n> ${text}   [${((Date.now() - t0) / 1000).toFixed(1)}s]`);
  for (const x of [...(j.replies ?? []), ...(j.inbox ?? [])]) console.log(String(x).replace(/\d{9,}/g, "[n]"));
  if (j.debug) console.log("DEBUG:", j.debug);
}
