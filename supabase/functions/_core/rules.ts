// Decision rules. Pure and unit-tested. Meta's models observe; these rules decide;
// only a "consistent" outcome pays. Ambiguous evidence is "unresolved" (the agent asks
// for better evidence) — never an accusation.
import type { Protocol, Tri } from "./protocols.ts";

export type Outcome = "consistent" | "unresolved" | "contradicted";

export interface Observation {
  answers: Record<string, Tri>;
  possibly_ai_generated_or_edited: boolean;
  confidence: number; // 0..1
  notes: string;
  better_evidence: string; // what would resolve any doubt, in plain words
}

export interface Context {
  duplicatePhoto: boolean;          // same image bytes already used in another claim
  daysSinceParent: number | null;   // follow-up protocols only
  distanceFromParentM: number | null;
  hasLocation: boolean;
}

export interface Decision {
  outcome: Outcome;
  reasons: string[];
  reward: number;
}

export const CONFIDENT = 0.7;
export const MIN_CONFIDENCE = 0.4;

export function decide(p: Protocol, obs: Observation, counts: Record<string, number>, ctx: Context): Decision {
  const hard: string[] = [];
  const doubts: string[] = [];
  const confident = obs.confidence >= CONFIDENT;

  if (ctx.duplicatePhoto) hard.push("This exact photo was already used for another claim.");
  if (!ctx.hasLocation) doubts.push("No location was shared.");

  if (p.parent) {
    if (ctx.distanceFromParentM !== null && ctx.distanceFromParentM > p.parent.maxDistanceM) {
      hard.push(`Location is ${Math.round(ctx.distanceFromParentM)} m from the original (allowed ${p.parent.maxDistanceM} m).`);
    }
    if (ctx.daysSinceParent !== null && ctx.daysSinceParent < p.parent.minDays) {
      doubts.push(`Only ${ctx.daysSinceParent} days since planting (needs ${p.parent.minDays}).`);
    }
  }

  for (const r of p.photos) {
    const n = counts[r.role] ?? 0;
    if (n < r.minCount) doubts.push(`SAM 3.1 found no ${r.sam.join(" or ")} in the ${r.label.toLowerCase()} photo.`);
  }

  for (const q of p.questions) {
    const a = obs.answers[q.key] ?? "unclear";
    if (a === q.expect) continue;
    if (a === "unclear") doubts.push(`Unclear: ${q.ask}`);
    else if (q.hard && confident) hard.push(`Muse Spark: ${q.ask} → ${a}.`);
    else doubts.push(`Muse Spark (low confidence): ${q.ask} → ${a}.`);
  }

  if (obs.possibly_ai_generated_or_edited) doubts.push("Muse Spark sees signs the photo may be AI-generated or edited.");
  if (obs.confidence < MIN_CONFIDENCE) doubts.push("The models were not confident about these photos.");

  if (p.id === "cleanup" && (counts.after ?? 0) >= (counts.before ?? 0) && (counts.before ?? 0) > 0) {
    doubts.push("SAM 3.1 counts as much litter after the cleanup as before.");
  }

  if (hard.length) return { outcome: "contradicted", reasons: [...hard, ...doubts], reward: 0 };
  if (doubts.length) return { outcome: "unresolved", reasons: doubts, reward: 0 };
  return { outcome: "consistent", reasons: ["All checks passed."], reward: p.reward(counts) };
}

/** Great-circle distance in metres. */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}
