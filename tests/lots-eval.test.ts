import { describe, expect, test } from "bun:test";
import { canonicalDataset, computeMetrics, countError, type EvaluationCase, type EvaluationResult } from "../scripts/lots-metrics.ts";
import type { Assessment } from "../supabase/functions/_core/loop.ts";

const assessment = (outcome: Assessment["outcome"], identified_as = "pet_bottles", sam_count = 8): Assessment => ({
  outcome, identified_as,
  observation: { identified_as, matches_claim: "yes", condition_good: "yes", code_seen: "ABCD", estimated_quantity: sam_count, possibly_ai_generated_or_edited: false, confidence: 0.9, notes: "" },
  sam_count, grade: "A", verified_quantity: sam_count, reasons: [],
} as Assessment);

const row = (id: string, expected: EvaluationResult["expected"], actual: EvaluationResult["expected"], fake: boolean, human_count: number | null): EvaluationResult => {
  const a = assessment(actual);
  return { id, material: "pet_bottles", expected, fake, human_count, assessment: a, count_error: countError(a, human_count, "pet_bottles") };
};

describe("waste lot evaluation metrics", () => {
  test("computes disposition, identification, fake acceptance, real rejection and count error", () => {
    const metrics = computeMetrics([
      row("real-listed", "listed", "listed", false, 10),
      row("fake-listed", "rejected", "listed", true, 8),
      row("real-rejected", "listed", "needs_better_photo", false, 8),
    ]);
    expect(metrics.disposition_accuracy).toEqual({ numerator: 1, denominator: 3 });
    expect(metrics.confusion_matrix.listed.needs_better_photo).toBe(1);
    expect(metrics.false_accept_fakes).toMatchObject({ numerator: 1, denominator: 1, rate: 1 });
    expect(metrics.false_reject_real_listed).toMatchObject({ numerator: 1, denominator: 2, rate: 0.5 });
    expect(metrics.identification_accuracy).toMatchObject({ numerator: 3, denominator: 3, rate: 1 });
    expect(metrics.count_error.mean_absolute_error).toBeCloseTo(2 / 3); expect(metrics.count_error.count).toBe(3);
  });
  test("uses null rates for empty denominators and excludes failed cases", () => {
    const metrics = computeMetrics([{ id: "err", material: "pet_bottles", expected: "listed", fake: false, human_count: null, error: "offline" }]);
    expect(metrics.assessed).toBe(0);
    expect(metrics.listed_precision.rate).toBeNull();
    expect(metrics.false_accept_fakes.rate).toBeNull();
    expect(metrics.count_error).toEqual({ mean_absolute_error: null, count: 0 });
  });
  test("versions every label and frozen file hash, independent of case order", () => {
    const base: EvaluationCase = {
      id: "case-1", file: "lot.jpg", image_sha256: "a".repeat(64), material: "pet_bottles",
      claimed_qty: 10, code: "ABCD", expected: "listed", human_count: 10, fake: false,
      notes: "Two reviewers agreed", reviewers: ["reviewer_alpha", "reviewer_beta"], review_agreement: true,
    };
    const other: EvaluationCase = { ...base, id: "case-2", file: "lot2.jpg", image_sha256: "b".repeat(64) };
    expect(canonicalDataset([base, other])).toEqual(canonicalDataset([other, base]));
    expect(canonicalDataset([{ ...base, expected: "rejected" }])).not.toEqual(canonicalDataset([base]));
    expect(canonicalDataset([{ ...base, human_count: 11 }])).not.toEqual(canonicalDataset([base]));
    expect(canonicalDataset([{ ...base, reviewers: ["reviewer_gamma", "reviewer_delta"] as [string, string] }])).not.toEqual(canonicalDataset([base]));
    expect(canonicalDataset([{ ...base, image_sha256: "c".repeat(64) }])).not.toEqual(canonicalDataset([base]));
  });
  test("returns absolute count difference", () => {
    expect(countError(assessment("listed", "pet_bottles", 8), 10, "pet_bottles")).toBe(2);
    expect(countError(assessment("listed"), null, "pet_bottles")).toBeNull();
  });
});
