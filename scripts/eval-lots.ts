import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, extname } from "node:path";
import { assessLot, MATERIALS, type Assessment, type MaterialId } from "../supabase/functions/_core/loop.ts";
import { bytesToDataUrl, clientFromEnv } from "../supabase/functions/_core/meta.ts";
import { canonicalDataset, computeMetrics, countError, type EvaluationCase, type EvaluationResult } from "./lots-metrics.ts";

const root = resolve(import.meta.dir, "..");
const datasetDir = resolve(root, "evals/lots");
const allowed = new Set<MaterialId>(Object.keys(MATERIALS) as MaterialId[]);
const providerArg = process.argv.find((arg) => arg.startsWith("--provider="))?.split("=")[1] ?? "meta";
if (providerArg !== "meta" && providerArg !== "baseten") throw new Error("Use --provider=meta or --provider=baseten");
if (providerArg === "baseten") process.env.CHAT_PROVIDER = "baseten";
else delete process.env.CHAT_PROVIDER;

const labels = JSON.parse(await readFile(resolve(datasetDir, "labels.json"), "utf8")) as EvaluationCase[];
if (!Array.isArray(labels) || labels.length === 0) throw new Error("No frozen cases in evals/lots/labels.json; add and review cases before running models.");
if (providerArg === "baseten" && !process.env.BASETEN_API_KEY) throw new Error("Set BASETEN_API_KEY for --provider=baseten");
if (providerArg === "meta" && !process.env.MODEL_API_KEY) throw new Error("Set MODEL_API_KEY for --provider=meta");

const seen = new Set<string>();
const frozen = await Promise.all(labels.map(async (c) => {
  if (typeof c.id !== "string" || !c.id.trim() || seen.has(c.id)) throw new Error(`Missing or duplicate case id: ${c.id}`);
  seen.add(c.id);
  if (!allowed.has(c.material) || !["listed", "needs_better_photo", "rejected"].includes(c.expected)) throw new Error(`Invalid labels for ${c.id}`);
  if (!(typeof c.claimed_qty === "number" && Number.isFinite(c.claimed_qty) && c.claimed_qty > 0) || typeof c.code !== "string" || c.code.length > 40 || typeof c.fake !== "boolean") throw new Error(`Invalid case fields for ${c.id}`);
  if (typeof c.notes !== "string" || !c.notes.trim()) throw new Error(`Missing reviewer rationale for ${c.id}`);
  if (!Array.isArray(c.reviewers) || c.reviewers.length !== 2 || c.reviewers.some((r) => typeof r !== "string" || !/^reviewer_[a-z0-9_-]{3,32}$/i.test(r)) || c.reviewers[0].toLowerCase() === c.reviewers[1].toLowerCase() || c.review_agreement !== true) throw new Error(`Two distinct non-identifying reviewer handles must agree for ${c.id}`);
  if (typeof c.image_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(c.image_sha256)) throw new Error(`Missing frozen image SHA-256 for ${c.id}`);
  if (c.human_count !== null && !(typeof c.human_count === "number" && Number.isInteger(c.human_count) && c.human_count >= 0)) throw new Error(`Invalid human_count for ${c.id}`);
  if (typeof c.file !== "string" || !c.file) throw new Error(`Missing image path for ${c.id}`);
  const file = resolve(datasetDir, c.file);
  if (!file.startsWith(datasetDir + "\\") && !file.startsWith(datasetDir + "/")) throw new Error(`Case image must be inside evals/lots: ${c.id}`);
  const bytes = new Uint8Array(await readFile(file));
  const ext = extname(file).toLowerCase();
  const mime = ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" } as Record<string, string>)[ext];
  if (!mime) throw new Error(`Unsupported image type for ${c.id}: ${ext}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256.toLowerCase() !== c.image_sha256.toLowerCase()) throw new Error(`Frozen image SHA-256 mismatch for ${c.id}`);
  return { ...c, bytes, mime, sha256 };
}));
const meta = clientFromEnv((k) => process.env[k]);
let calls = 0;
const callEvents: Array<{ model: string; endpoint: string; ms: number; ok: boolean }> = [];
meta.onCall = (event) => { calls++; callEvents.push(event); };
const output: EvaluationResult[] = [];
const caseMeta: Array<{ id: string; sha256: string; cost: null; api_calls: number; model_calls: typeof callEvents }> = [];
for (const c of frozen) {
  const before = calls;
  const eventStart = callEvents.length;
  try {
    const assessment: Assessment = await assessLot(meta, MATERIALS[c.material], c.claimed_qty, bytesToDataUrl(c.bytes, c.mime), c.code || null);
    output.push({ id: c.id, material: c.material, expected: c.expected, fake: c.fake, human_count: c.human_count,
      assessment, count_error: countError(assessment, c.human_count, c.material) });
  } catch (e) {
    output.push({ id: c.id, material: c.material, expected: c.expected, fake: c.fake, human_count: c.human_count, error: String(e) });
  }
  caseMeta.push({ id: c.id, sha256: c.sha256, cost: null, api_calls: calls - before, model_calls: callEvents.slice(eventStart) });
  console.log(c.id, output[output.length - 1].assessment?.outcome ?? "error");
}
const report = { dataset_version: createHash("sha256").update(JSON.stringify(canonicalDataset(frozen))).digest("hex"),
  run_at: new Date().toISOString(), provider: providerArg, chat_model: meta.reasoningModel,
  sam_model: meta.canSegment ? "sam-3.1" : null, api_calls: calls, cost_per_case: "unknown", cases: output, case_metadata: caseMeta, metrics: computeMetrics(output) };
await mkdir(datasetDir, { recursive: true });
await writeFile(resolve(datasetDir, "results.json"), JSON.stringify(report, null, 2) + "\n");
const pct = (m: { numerator: number; denominator: number; rate?: number | null }) => `${m.numerator}/${m.denominator}` + (m.rate == null ? " (n/a)" : ` (${(m.rate * 100).toFixed(1)}%)`);
const rows = output.map((r) => `| ${r.id} | ${r.material} | ${r.expected} | ${r.assessment?.outcome ?? "error"} | ${r.error ?? ""} |`).join("\n");
const m = report.metrics;
const confusionTable = `| Human \\ Predicted | listed | needs_better_photo | rejected |\n|---|---:|---:|---:|\n${(["listed", "needs_better_photo", "rejected"] as const).map((expected) => `| ${expected} | ${m.confusion_matrix[expected].listed} | ${m.confusion_matrix[expected].needs_better_photo} | ${m.confusion_matrix[expected].rejected} |`).join("\n")}`;
const section = `## Waste lot evaluation (C6)\n\nRun ${report.run_at}; provider ${providerArg}; chat model ${report.chat_model}; SAM ${report.sam_model ?? "not configured"}; dataset ${report.dataset_version}; cost per case unknown.\n\n- Disposition accuracy: ${pct(m.disposition_accuracy)}\n- Listed precision: ${pct(m.listed_precision)}\n- Listed recall: ${pct(m.listed_recall)}\n- Identification accuracy: ${pct(m.identification_accuracy)}\n- False accept of fakes: ${pct(m.false_accept_fakes)}\n- False reject of real listed lots: ${pct(m.false_reject_real_listed)}\n- Count MAE: ${m.count_error.mean_absolute_error ?? "n/a"} across ${m.count_error.count} cases\n- API calls: ${calls}\n\nConfusion matrix (rows = human label, columns = predicted):\n\n${confusionTable}\n\n| Case | Material | Expected | Outcome | Error |\n|---|---|---|---|---|\n${rows}\n\nDetails: [protocol](PROTOCOL.md), [raw results](lots/results.json).\n`;
const readme = resolve(root, "evals/README.md");
let prior = "";
try { prior = await readFile(readme, "utf8"); } catch { /* first evaluation */ }
prior = prior.replace(/\n?## Waste lot evaluation \(C6\)[\s\S]*$/, "");
await writeFile(readme, `${prior.trimEnd()}\n\n${section}`);
console.log(JSON.stringify(report.metrics, null, 2));
