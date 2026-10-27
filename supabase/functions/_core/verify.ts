// Verifies one claim with Meta's models, then lets the rules decide and the ledger pay.
//   SAM 3.1      counts the things that matter in each photo (saplings, litter, bottles).
//   Muse Spark   answers the protocol's yes/no/unclear questions about the photos.
//   rules.ts     turns observations into consistent / unresolved / contradicted.
// The AI never chooses an amount: only a consistent decision credits the protocol's reward.
import { type MetaClient, MODELS } from "./meta.ts";
import { PROTOCOLS, type Protocol, type Tri } from "./protocols.ts";
import { parseSamOutput, type SamBox } from "./sam.ts";
import { daysBetween, decide, haversineM, type Observation } from "./rules.ts";
import type { Check, Claim, Evidence, Store } from "./store.ts";
import type { LedgerEntry } from "./ledger.ts";

const MIN_SAM_CONFIDENCE = 0.5;
const TRI = { type: "string", enum: ["yes", "no", "unclear"] };

export function observationSchema(p: Protocol) {
  const answers: Record<string, unknown> = {};
  for (const q of p.questions) answers[q.key] = TRI;
  return {
    type: "object",
    additionalProperties: false,
    required: ["answers", "possibly_ai_generated_or_edited", "confidence", "notes", "better_evidence"],
    properties: {
      answers: { type: "object", additionalProperties: false, required: p.questions.map((q) => q.key), properties: answers },
      possibly_ai_generated_or_edited: { type: "boolean" },
      confidence: { type: "number" },
      notes: { type: "string" },
      better_evidence: { type: "string" },
    },
  };
}

export function observerPrompt(p: Protocol): string {
  return `You check evidence for a climate-action reward: "${p.title}". ${p.summary}
Answer ONLY from what is visible in the photos. Use "unclear" whenever you are not sure — never guess.
Questions (answer each yes / no / unclear):
${p.questions.map((q) => `- ${q.key}: ${q.ask}`).join("\n")}
possibly_ai_generated_or_edited: true only for clear signs (impossible lighting or shadows, warped or melted objects, pasted elements, text artefacts, overly perfect render look).
confidence: your overall confidence 0..1 in these answers.
notes: at most 50 words, plain language, describing what you see. No accusations.
better_evidence: if anything is unclear, one short sentence telling the person what photo would settle it; otherwise "".`;
}

export interface VerifyResult {
  claim: Claim;
  check: Check;
  credit: LedgerEntry | null;
}

export async function verifyClaim(meta: MetaClient, store: Store, claimId: string, now: Date): Promise<VerifyResult> {
  const claim = await store.claim(claimId);
  if (!claim) throw new Error("claim not found");
  const p = PROTOCOLS[claim.protocol];
  const ev = await store.evidenceOf(claim.id);
  const photos = new Map<string, Evidence>();
  for (const e of ev) if (e.kind === "photo" && e.role) photos.set(e.role, e); // latest per role
  for (const r of p.photos) if (!photos.has(r.role)) throw new Error(`missing photo: ${r.role}`);

  let parent: Claim | null = null;
  let parentPhoto: Evidence | undefined;
  if (claim.parent_id) {
    parent = await store.claim(claim.parent_id);
    parentPhoto = (await store.evidenceOf(claim.parent_id)).find((e) => e.kind === "photo");
  }

  await store.updateClaim(claim.id, { status: "verifying" });
  let calls = 0;
  const t0 = Date.now();
  const urls = new Map<string, string>();
  for (const [role, e] of photos) urls.set(role, await store.photoDataUrl(e.path!));

  try {
    // SAM 3.1: one call per (photo, noun phrase), in parallel.
    const jobs = p.photos.flatMap((r) => r.sam.map((phrase) => ({ role: r.role, phrase })));
    const samRuns = await Promise.all(jobs.map(async (j) => {
      calls++;
      const frames = parseSamOutput(await meta.segment(urls.get(j.role)!, j.phrase));
      const f = frames.find((x) => x.frame === 0) ?? frames[0];
      return { role: j.role, phrase: j.phrase, boxes: (f?.boxes ?? []).filter((b) => b.c === null || b.c >= MIN_SAM_CONFIDENCE) };
    }));
    const counts: Record<string, number> = {};
    const boxes: Record<string, Array<SamBox & { label: string }>> = {};
    for (const r of p.photos) { counts[r.role] = 0; boxes[r.role] = []; }
    for (const run of samRuns) {
      counts[run.role] += run.boxes.length;
      boxes[run.role].push(...run.boxes.map((b) => ({ ...b, label: run.phrase })));
    }

    // Muse Spark: all photos in one call, labelled.
    const content: Array<Record<string, unknown>> = [];
    if (parentPhoto?.path) {
      content.push({ type: "text", text: `Original planting photo (${parent?.created_at.slice(0, 10)}):` });
      content.push({ type: "image_url", image_url: { url: await store.photoDataUrl(parentPhoto.path) } });
    }
    for (const r of p.photos) {
      content.push({ type: "text", text: `${r.label} photo:` });
      content.push({ type: "image_url", image_url: { url: urls.get(r.role)! } });
    }
    calls++;
    const raw = await meta.chatJSON<Observation>({ system: observerPrompt(p), user: content, name: `${p.id}_observation`, schema: observationSchema(p) });
    const observation = normalise(raw, p);

    let duplicate = false;
    for (const e of photos.values()) if (e.sha256 && await store.photoHashUsedElsewhere(e.sha256, claim.id)) duplicate = true;
    const hasLoc = claim.lat !== null && claim.lng !== null;
    const decision = decide(p, observation, counts, {
      duplicatePhoto: duplicate,
      hasLocation: hasLoc,
      daysSinceParent: parent ? daysBetween(parent.created_at, now.toISOString()) : null,
      distanceFromParentM: parent && hasLoc && parent.lat !== null && parent.lng !== null
        ? haversineM({ lat: parent.lat, lng: parent.lng! }, { lat: claim.lat!, lng: claim.lng! })
        : null,
    });

    const check = await store.addCheck({
      claim_id: claim.id, decision, observation, counts, boxes,
      models: { segmentation: MODELS.sam, reasoning: MODELS.spark, calls, ms: Date.now() - t0 },
    });
    let credit: LedgerEntry | null = null;
    if (decision.outcome === "consistent" && decision.reward > 0) {
      [credit] = await store.post([{ account_id: claim.account_id, amount: decision.reward, kind: "reward" }], claim.id, `Witness · ${p.title}`);
    }
    await store.updateClaim(claim.id, { status: decision.outcome, reward: decision.reward, verified_at: now.toISOString() });
    return { claim: (await store.claim(claim.id))!, check, credit };
  } catch (e) {
    await store.updateClaim(claim.id, { status: "collecting" });
    throw e;
  }
}

function normalise(o: Partial<Observation> | null, p: Protocol): Observation {
  const answers: Record<string, Tri> = {};
  for (const q of p.questions) {
    const a = o?.answers?.[q.key];
    answers[q.key] = a === "yes" || a === "no" ? a : "unclear";
  }
  return {
    answers,
    possibly_ai_generated_or_edited: o?.possibly_ai_generated_or_edited === true,
    confidence: Math.max(0, Math.min(1, Number(o?.confidence) || 0)),
    notes: String(o?.notes ?? "").slice(0, 400),
    better_evidence: String(o?.better_evidence ?? "").slice(0, 300),
  };
}
