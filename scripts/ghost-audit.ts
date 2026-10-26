// Ghost Audit: attack ECO's own checks with Meta's own image model, and measure honestly.
//   1. Muse Image generates fraudulent evidence (fake plantings, potted plants, shop shelves, mismatched cleanups).
//   2. Real photos from evals/real/ (with labels.json) measure how often honest people get paid.
//   3. Every case runs through the production verifier (SAM 3.1 + Muse Spark + rules) in memory.
// Writes evals/results.json and evals/README.md. Costs roughly 3–4 Meta API calls per case.
//   MODEL_API_KEY=... bun scripts/ghost-audit.ts [--no-generate]
import { mkdir, readdir } from "node:fs/promises";
import { MetaClient } from "../supabase/functions/_core/meta.ts";
import { MemoryStore } from "../supabase/functions/_core/store.ts";
import { verifyClaim } from "../supabase/functions/_core/verify.ts";
import { sha256Hex } from "../supabase/functions/_core/ledger.ts";
import type { ProtocolId } from "../supabase/functions/_core/protocols.ts";

const ROOT = `${import.meta.dir}/../evals`;
const key = process.env.MODEL_API_KEY;
if (!key) throw new Error("Set MODEL_API_KEY");
const meta = new MetaClient(key);
let calls = 0;
meta.onCall = () => calls++;

interface Case { id: string; kind: "fake" | "real"; protocol: ProtocolId; photos: Record<string, string>; expectPaid: boolean; note: string }

const FAKES: Array<{ id: string; protocol: ProtocolId; prompts: Record<string, string>; note: string }> = [
  { id: "ai-sapling-1", protocol: "tree_planting", prompts: { planting: "smartphone photo of a young tree sapling freshly planted in dark soil, daylight, slightly blurry, realistic" }, note: "Fully AI-generated planting photo" },
  { id: "ai-sapling-2", protocol: "tree_planting", prompts: { planting: "a person's hands pressing soil around a newly planted mango seedling in a rural garden, phone camera photo" }, note: "AI-generated planting with hands" },
  { id: "potted-plant", protocol: "tree_planting", prompts: { planting: "a small green plant in a plastic pot on a kitchen table indoors, phone photo" }, note: "Potted indoor plant passed off as planting" },
  { id: "mature-tree", protocol: "tree_planting", prompts: { planting: "a large old tree in a city park, phone photo" }, note: "Existing mature tree, nothing planted" },
  { id: "shop-shelf", protocol: "recycling", prompts: { items: "supermarket shelf full of new unopened plastic soda bottles and cans, phone photo" }, note: "New stock on a shop shelf, not collected waste" },
  { id: "ai-recyclables", protocol: "recycling", prompts: { items: "used crushed plastic bottles and drink cans spread out on the ground for counting, phone photo" }, note: "AI-generated recyclables" },
  { id: "cleanup-two-places", protocol: "cleanup", prompts: { before: "a roadside ditch full of plastic litter in a town, phone photo", after: "a clean empty beach with white sand, phone photo" }, note: "Before and after from different places" },
  { id: "cleanup-no-change", protocol: "cleanup", prompts: { before: "plastic bags and bottles littered on an empty lot, phone photo", after: "plastic bags and bottles littered on an empty lot, phone photo, slightly different angle" }, note: "After photo still littered" },
];

async function generate(): Promise<Case[]> {
  await mkdir(`${ROOT}/fakes`, { recursive: true });
  const out: Case[] = [];
  for (const f of FAKES) {
    const photos: Record<string, string> = {};
    for (const [role, prompt] of Object.entries(f.prompts)) {
      const path = `${ROOT}/fakes/${f.id}-${role}.jpg`;
      if (!(await Bun.file(path).exists())) await Bun.write(path, await meta.generateImage(prompt));
      photos[role] = path;
    }
    out.push({ id: f.id, kind: "fake", protocol: f.protocol, photos, expectPaid: false, note: f.note });
  }
  return out;
}

async function realCases(): Promise<Case[]> {
  const labels = Bun.file(`${ROOT}/real/labels.json`);
  if (!(await labels.exists())) return [];
  const list = (await labels.json()) as Array<{ id: string; protocol: ProtocolId; photos: Record<string, string>; paid: boolean; note: string }>;
  return list.map((l) => ({ id: l.id, kind: "real", protocol: l.protocol, expectPaid: l.paid, note: l.note,
    photos: Object.fromEntries(Object.entries(l.photos).map(([r, p]) => [r, `${ROOT}/real/${p}`])) }));
}

async function run(c: Case, store: MemoryStore) {
  const acct = await store.createAccount(`audit-${c.id}`);
  const claim = await store.createClaim({ account_id: acct.id, protocol: c.protocol, parent_id: null, lat: 0, lng: 0 });
  for (const [role, file] of Object.entries(c.photos)) {
    const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
    await store.addEvidence({ claim_id: claim.id, account_id: acct.id, kind: "photo", role, path: await store.savePhoto(bytes, "image/jpeg"), sha256: await sha256Hex(bytes), lat: null, lng: null, text: null });
  }
  const r = await verifyClaim(meta, store, claim.id, new Date());
  return { outcome: r.check.decision.outcome, reward: r.check.decision.reward, reasons: r.check.decision.reasons, notes: r.check.observation.notes, counts: r.check.counts, ai_flag: r.check.observation.possibly_ai_generated_or_edited };
}

const cases = [...(process.argv.includes("--no-generate") ? [] : await generate()), ...(await realCases())];
const store = new MemoryStore();
const results = [];
for (const c of cases) {
  try {
    const r = await run(c, store);
    const paid = r.outcome === "consistent";
    results.push({ ...c, photos: Object.keys(c.photos), ...r, paid, correct: paid === c.expectPaid });
    console.log(c.id, r.outcome, paid === c.expectPaid ? "✓" : "✗");
  } catch (e) {
    results.push({ ...c, photos: Object.keys(c.photos), error: String(e) });
    console.log(c.id, "error", String(e));
  }
}
// Replay attack: resubmit the first real (or fake) photo as a new claim — must never pay twice.
const replaySrc = cases.find((c) => c.kind === "real") ?? cases[0];
if (replaySrc) {
  const r = await run({ ...replaySrc, id: `${replaySrc.id}-replay` }, store).catch((e) => ({ outcome: "error", error: String(e) }));
  results.push({ id: `${replaySrc.id}-replay`, kind: "fake", protocol: replaySrc.protocol, note: "Same photo submitted again as a new claim", expectPaid: false, ...r, paid: r.outcome === "consistent", correct: r.outcome !== "consistent" });
}

const fakes = results.filter((r) => r.kind === "fake" && !("error" in r && r.error));
const reals = results.filter((r) => r.kind === "real" && !("error" in r && r.error));
const summary = {
  run_at: new Date().toISOString(),
  models: ["sam-3.1", "muse-spark-1.3", "muse-image-1.0"],
  fraud_blocked: `${fakes.filter((r) => !r.paid).length}/${fakes.length}`,
  honest_paid: reals.length ? `${reals.filter((r) => r.paid && r.expectPaid).length}/${reals.filter((r) => r.expectPaid).length}` : "n/a",
  api_calls: calls,
};
await Bun.write(`${ROOT}/results.json`, JSON.stringify({ summary, results }, null, 2));

const rows = results.map((r: any) => `| ${r.id} | ${r.kind} | ${r.protocol} | ${r.note} | ${r.outcome ?? "error"} | ${r.correct ? "✓" : "✗"} |`).join("\n");
await Bun.write(`${ROOT}/README.md`, `# Ghost Audit — ECO attacks its own checks

Run ${summary.run_at.slice(0, 10)} with ${summary.models.join(", ")} · ${summary.api_calls} API calls.

- **Fraud blocked:** ${summary.fraud_blocked} fake or replayed claims were not paid.
- **Honest people paid:** ${summary.honest_paid} real claims were paid.

Fakes are generated by Muse Image (\`evals/fakes/\`); real photos and labels are in \`evals/real/\`. Each case runs through the
production verifier: SAM 3.1 counts, Muse Spark observations, then the fixed rules. "Unresolved" counts as not paid —
the person is asked for better evidence, never accused.

| Case | Type | Action | What it tests | Outcome | Correct |
|---|---|---|---|---|---|
${rows}

Reproduce: \`MODEL_API_KEY=... bun scripts/ghost-audit.ts\`. Full model notes per case: \`evals/results.json\`.
`);
console.log(summary);
