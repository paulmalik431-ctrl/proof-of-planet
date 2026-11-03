// Runs the Ghost Audit on the deployed `ghost-audit` function (which holds the Meta key), one case per request,
// then writes evals/results.json and evals/README.md. No secrets needed here.   bun scripts/ghost-remote.ts
import { SUPABASE_URL } from "../web/config.js";

const FN = `${SUPABASE_URL}/functions/v1/ghost-audit`;
const IMG = `${SUPABASE_URL}/storage/v1/object/public/evidence`;
const { cases } = await (await fetch(FN)).json() as { cases: string[] };
const results: Array<Record<string, any>> = [];
for (const id of cases) {
  let r: Record<string, any> = { id, error: "not run" };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${FN}?case=${id}`, { signal: AbortSignal.timeout(170_000) });
      r = await res.json();
      if (!r.error) break;
    } catch (e) { r = { id, error: String(e) }; }
  }
  results.push(r);
  console.log(`${id}: ${r.error ? `error ${r.error}` : `${r.outcome}${r.paid ? " — PAID" : " — not paid"}${r.ai_flag ? " · AI-made flagged" : ""}`}`);
}
const done = results.filter((r) => !r.error);
const blocked = done.filter((r) => !r.paid);
const summary = { run_at: new Date().toISOString(), cases: results.length, completed: done.length, blocked: blocked.length, ai_flagged: done.filter((r) => r.ai_flag).length };
await Bun.write(`${import.meta.dir}/../evals/results.json`, JSON.stringify({ summary, results }, null, 2));
const word = (o: string) => ({ consistent: "verified (paid)", unresolved: "needs better evidence (not paid)", contradicted: "contradicted (not paid)", listed: "listed", needs_better_photo: "needs a better photo (not listed)", rejected: "rejected (not listed)" } as Record<string, string>)[o] ?? o;
const rows = results.map((r) => r.error
  ? `| ${r.id} | — | — | error: ${String(r.error).slice(0, 60)} | — |`
  : `| ${r.id} | ${r.note} | ${(r.images ?? []).map((p: string, i: number) => `[image ${i + 1}](${IMG}/${p})`).join(" ")} | ${word(r.outcome)}${r.ai_flag ? " · flagged as possibly AI-made" : ""} | ${r.paid ? (r.type === "lot" ? "✗ listed (no ECOIN moves until the buyer physically counts the lot)" : "✗ paid") : "✓ blocked"} |`).join("\n");
await Bun.write(`${import.meta.dir}/../evals/README.md`, `# Ghost Audit — ECO attacks its own checks

Run ${summary.run_at.slice(0, 10)}. Meta's **Muse Image** generated fraudulent evidence; ECO's production checks
(**SAM 3.1** + **Muse Spark 1.3** + fixed rules for claims, the Loop lot check with a one-time paper code for listings) tried to catch it.

- **Fraud blocked:** ${blocked.length} of ${done.length} fake or replayed attempts were not paid or listed.
- **Flagged as possibly AI-made by Muse Spark:** ${summary.ai_flagged} of ${done.length}.
${done.length < results.length ? `- ${results.length - done.length} case(s) did not complete (shown as errors below).\n` : ""}
"Needs better evidence" counts as not paid: the person is asked for a better photo, never accused.
This measures fraud only. How often honest people are paid needs a labelled set of real photos (\`evals/real/\`), which is not built yet.

| Case | Attack | Fake images (Muse Image) | ECO's decision | Result |
|---|---|---|---|---|
${rows}

Reproduce: \`bun scripts/ghost-remote.ts\` (calls the deployed \`ghost-audit\` function), or locally with a key: \`MODEL_API_KEY=... bun scripts/ghost-audit.ts\`.
`);
console.log(summary);
