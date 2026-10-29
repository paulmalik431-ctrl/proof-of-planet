import { MATERIALS, type Assessment, type MaterialId } from "../supabase/functions/_core/loop.ts";

export type Outcome = Assessment["outcome"];
export interface EvaluationCase {
  id: string;
  file: string;
  image_sha256: string;
  material: MaterialId;
  claimed_qty: number;
  code: string;
  expected: Outcome;
  human_count: number | null;
  fake: boolean;
  notes: string;
  reviewers: [string, string];
  review_agreement: true;
}
export interface EvaluationResult {
  id: string;
  material: MaterialId;
  expected: Outcome;
  fake: boolean;
  human_count: number | null;
  assessment?: Assessment;
  count_error?: number | null;
  error?: string;
}

/** Stable, complete dataset content for versioning. Reviewer handles are non-identifying aliases. */
export function canonicalDataset(cases: EvaluationCase[]) {
  return [...cases].sort((a, b) => a.id.localeCompare(b.id)).map((c) => ({
    id: c.id, file: c.file, image_sha256: c.image_sha256, material: c.material,
    claimed_qty: c.claimed_qty, code: c.code, expected: c.expected, human_count: c.human_count,
    fake: c.fake, notes: c.notes, reviewers: [...c.reviewers].sort(), review_agreement: c.review_agreement,
  }));
}
const OUTCOMES: Outcome[] = ["listed", "needs_better_photo", "rejected"];
const ratio = (n: number, d: number) => d ? n / d : null;

export function computeMetrics(results: EvaluationResult[]) {
  const matrix = Object.fromEntries(OUTCOMES.map((expected) => [expected,
    Object.fromEntries(OUTCOMES.map((actual) => [actual, 0]))])) as Record<Outcome, Record<Outcome, number>>;
  const completed = results.filter((r) => r.assessment);
  for (const r of completed) matrix[r.expected][r.assessment!.outcome]++;
  const listedTP = completed.filter((r) => r.expected === "listed" && r.assessment!.outcome === "listed").length;
  const predictedListed = completed.filter((r) => r.assessment!.outcome === "listed").length;
  const expectedListed = completed.filter((r) => r.expected === "listed").length;
  const ids = completed.filter((r) => r.assessment!.observation.identified_as === r.material).length;
  const fakeCases = completed.filter((r) => r.fake);
  const realExpectedListed = completed.filter((r) => !r.fake && r.expected === "listed");
  const errors = completed.map((r) => r.count_error).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return {
    cases: results.length,
    assessed: completed.length,
    failed: results.length - completed.length,
    disposition_accuracy: { numerator: completed.filter((r) => r.expected === r.assessment!.outcome).length, denominator: completed.length },
    confusion_matrix: matrix,
    listed_precision: { numerator: listedTP, denominator: predictedListed, rate: ratio(listedTP, predictedListed) },
    listed_recall: { numerator: listedTP, denominator: expectedListed, rate: ratio(listedTP, expectedListed) },
    identification_accuracy: { numerator: ids, denominator: completed.length, rate: ratio(ids, completed.length) },
    false_accept_fakes: { numerator: fakeCases.filter((r) => r.assessment!.outcome === "listed").length, denominator: fakeCases.length, rate: ratio(fakeCases.filter((r) => r.assessment!.outcome === "listed").length, fakeCases.length) },
    false_reject_real_listed: { numerator: realExpectedListed.filter((r) => r.assessment!.outcome !== "listed").length, denominator: realExpectedListed.length, rate: ratio(realExpectedListed.filter((r) => r.assessment!.outcome !== "listed").length, realExpectedListed.length) },
    count_error: { mean_absolute_error: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null, count: errors.length },
  };
}

export function countError(result: Pick<Assessment, "sam_count" | "observation">, humanCount: number | null, material: MaterialId): number | null {
  if (humanCount === null || !Number.isFinite(humanCount)) return null;
  const estimated = MATERIALS[material].unit === "items" ? Math.max(result.sam_count, Math.round(result.observation.estimated_quantity || 0)) : result.observation.estimated_quantity;
  return Math.abs(estimated - humanCount);
}
