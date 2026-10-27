// Loop — the marketplace for climate waste. People sell sorted recyclables to businesses.
//   Witness-style assessment: SAM 3.1 counts the items, Muse Spark grades the lot, rules set the price.
//   Matching pairs a listing with the best open demand (material, price, distance).
//   Escrow holds the buyer's ECOIN until delivery; on a dispute Muse Spark recommends, a person decides.
import type { MetaClient } from "./meta.ts";
import { haversineM } from "./rules.ts";
import { countObjects, parseSamOutput } from "./sam.ts";

export type MaterialId = "pet_bottles" | "cans" | "cardboard" | "e_waste";
export type Grade = "A" | "B" | "C";

export interface Material {
  id: MaterialId;
  title: string;
  unit: "items" | "kg";
  sam: string;         // SAM 3.1 noun phrase
  refPrice: number;    // ECOIN per unit for a grade-A lot
}

export const MATERIALS: Record<MaterialId, Material> = {
  pet_bottles: { id: "pet_bottles", title: "PET plastic bottles", unit: "items", sam: "plastic bottle", refPrice: 2 },
  cans: { id: "cans", title: "Aluminium cans", unit: "items", sam: "drink can", refPrice: 3 },
  cardboard: { id: "cardboard", title: "Cardboard", unit: "kg", sam: "cardboard", refPrice: 4 },
  e_waste: { id: "e_waste", title: "E-waste (phones, chargers, small electronics)", unit: "items", sam: "electronic device", refPrice: 25 },
};

export const GRADE_FACTOR: Record<Grade, number> = { A: 1, B: 0.8, C: 0.6 };

export interface Listing {
  id: string;
  seller: string;
  material: MaterialId;
  quantity: number;
  unit: "items" | "kg";
  price: number;          // ECOIN per unit, set by the rules
  grade: Grade | null;
  sam_count: number;
  photo_path: string | null;
  photo_sha256: string | null;
  lat: number | null;
  lng: number | null;
  status: "draft" | "open" | "reserved" | "sold" | "cancelled";
  assessment: Assessment | null;
  created_at: string;
}

export interface Demand {
  id: string;
  buyer: string;
  material: MaterialId;
  quantity: number;       // remaining
  max_price: number;      // ECOIN per unit
  lat: number | null;
  lng: number | null;
  radius_km: number;
  status: "open" | "filled" | "cancelled";
  created_at: string;
}

export type TradeStatus = "proposed" | "escrowed" | "delivered" | "released" | "disputed" | "refunded" | "settled" | "declined";

export interface Trade {
  id: string;
  listing_id: string;
  demand_id: string;
  seller: string;
  buyer: string;
  material: MaterialId;
  quantity: number;
  unit: "items" | "kg";
  price: number;
  total: number;
  distance_km: number | null;
  status: TradeStatus;
  delivery_photo_path: string | null;
  dispute: { by: string; reason: string; at: string } | null;
  mediation: Mediation | null;
  decision: { outcome: "release" | "refund" | "split"; seller_share_pct: number; by: string; note: string; at: string } | null;
  history: Array<{ at: string; status: TradeStatus; note: string }>;
  created_at: string;
}

// ───────── assessment (AI observes, rules price) ─────────

export interface LotObservation {
  material_matches: "yes" | "no" | "unclear";
  sorted_and_clean: "yes" | "no" | "unclear";
  estimated_quantity: number;
  possibly_ai_generated_or_edited: boolean;
  confidence: number;
  notes: string;
}

export interface Assessment {
  observation: LotObservation;
  sam_count: number;
  grade: Grade | null;
  verified_quantity: number;
  price: number;
  outcome: "priced" | "needs_better_photo" | "rejected";
  reasons: string[];
}

const LOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["material_matches", "sorted_and_clean", "estimated_quantity", "possibly_ai_generated_or_edited", "confidence", "notes"],
  properties: {
    material_matches: { type: "string", enum: ["yes", "no", "unclear"] },
    sorted_and_clean: { type: "string", enum: ["yes", "no", "unclear"] },
    estimated_quantity: { type: "number" },
    possibly_ai_generated_or_edited: { type: "boolean" },
    confidence: { type: "number" },
    notes: { type: "string" },
  },
};

/** Pure pricing rules from what the models saw. */
export function priceLot(m: Material, claimed: number, samCount: number, o: LotObservation): Assessment {
  const reasons: string[] = [];
  const confident = o.confidence >= 0.7;
  if (o.material_matches === "no" && confident) {
    return { observation: o, sam_count: samCount, grade: null, verified_quantity: 0, price: 0, outcome: "rejected", reasons: [`The photo doesn't show ${m.title.toLowerCase()}.`] };
  }
  if (o.material_matches !== "yes") reasons.push(`Couldn't confirm the photo shows ${m.title.toLowerCase()}.`);
  if (o.possibly_ai_generated_or_edited) reasons.push("The photo may be AI-generated or edited.");
  const seen = Math.max(samCount, Math.round(o.estimated_quantity || 0));
  let qty: number;
  if (m.unit === "items") {
    if (seen === 0) reasons.push(`No ${m.sam}s could be found in the photo.`);
    qty = Math.min(claimed, Math.max(seen, 0));
    if (seen < claimed * 0.5) reasons.push(`The photo shows about ${seen}, not ${claimed}. Spread the lot out, or send it in parts.`);
  } else {
    qty = claimed;
    if (o.estimated_quantity < claimed * 0.5) reasons.push(`The photo looks like about ${Math.round(o.estimated_quantity)} kg, not ${claimed} kg.`);
  }
  if (reasons.length) return { observation: o, sam_count: samCount, grade: null, verified_quantity: qty, price: 0, outcome: "needs_better_photo", reasons };
  const grade: Grade = o.sorted_and_clean === "yes" ? "A" : o.sorted_and_clean === "unclear" ? "B" : "C";
  const price = Math.max(1, Math.round(m.refPrice * GRADE_FACTOR[grade]));
  return { observation: o, sam_count: samCount, grade, verified_quantity: qty, price, outcome: "priced", reasons: [`Grade ${grade}: ${price} ECOIN per ${m.unit === "kg" ? "kg" : "item"} × ${qty}.`] };
}

export async function assessLot(meta: MetaClient, m: Material, claimed: number, photoDataUrl: string): Promise<Assessment> {
  const [sam, obs] = await Promise.all([
    meta.canSegment ? meta.segment(photoDataUrl, m.sam).then((t) => countObjects(parseSamOutput(t))) : Promise.resolve(0),
    meta.chatJSON<LotObservation>({
      system: `You grade a lot of recyclable waste offered for sale: ${m.title}, the seller says ${claimed} ${m.unit}.
Answer only from the photo; use "unclear" when unsure.
material_matches: does the photo show ${m.title.toLowerCase()}?
sorted_and_clean: is the lot sorted (one material) and reasonably clean?
estimated_quantity: your estimate of how many ${m.unit} are visible.
possibly_ai_generated_or_edited: true only for clear signs. confidence: 0..1. notes: ≤40 words, plain, no accusations.`,
      user: [{ type: "text", text: "Lot photo:" }, { type: "image_url", image_url: { url: photoDataUrl } }],
      name: "lot_observation",
      schema: LOT_SCHEMA,
    }),
  ]);
  const o: LotObservation = {
    material_matches: ["yes", "no"].includes(obs.material_matches) ? obs.material_matches : "unclear",
    sorted_and_clean: ["yes", "no"].includes(obs.sorted_and_clean) ? obs.sorted_and_clean : "unclear",
    estimated_quantity: Math.max(0, Number(obs.estimated_quantity) || 0),
    possibly_ai_generated_or_edited: obs.possibly_ai_generated_or_edited === true,
    confidence: Math.max(0, Math.min(1, Number(obs.confidence) || 0)),
    notes: String(obs.notes ?? "").slice(0, 300),
  };
  return priceLot(m, claimed, sam, o);
}

// ───────── matching ─────────

export function distanceKm(a: { lat: number | null; lng: number | null }, b: { lat: number | null; lng: number | null }): number | null {
  if (a.lat === null || a.lng === null || b.lat === null || b.lng === null) return null;
  return Math.round(haversineM({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) / 100) / 10;
}

/** Best open demand for a listing: same material, buyer pays at least the price, within the buyer's radius.
 *  Ranked by the buyer's price (higher is better for the seller), then by distance. */
export function bestMatch(l: Listing, demands: Demand[]): { demand: Demand; quantity: number; distance_km: number | null } | null {
  const ok = demands
    .filter((d) => d.status === "open" && d.material === l.material && d.buyer !== l.seller && d.max_price >= l.price && d.quantity > 0)
    .map((d) => ({ d, km: distanceKm(l, d) }))
    .filter(({ d, km }) => km === null || km <= d.radius_km)
    .sort((a, b) => b.d.max_price - a.d.max_price || (a.km ?? 1e9) - (b.km ?? 1e9));
  if (!ok.length) return null;
  return { demand: ok[0].d, quantity: Math.min(l.quantity, ok[0].d.quantity), distance_km: ok[0].km };
}

// ───────── dispute mediation (AI recommends, a person decides) ─────────

export interface Mediation {
  recommendation: "release" | "refund" | "split";
  seller_share_pct: number;
  evidence_summary: string;
  reasoning: string;
  confidence: number;
}

export async function mediate(meta: MetaClient, t: Trade, listingPhoto: string | null, deliveryPhoto: string | null, statements: { buyer: string; seller: string }): Promise<Mediation> {
  const m = MATERIALS[t.material];
  const content: Array<Record<string, unknown>> = [{ type: "text", text: `Trade: ${t.quantity} ${m.unit} of ${m.title} at ${t.price} ECOIN each, total ${t.total}.\nBuyer says: "${statements.buyer}"\nSeller says: "${statements.seller || "(no statement yet)"}"` }];
  if (listingPhoto) content.push({ type: "text", text: "Photo when listed:" }, { type: "image_url", image_url: { url: listingPhoto } });
  if (deliveryPhoto) content.push({ type: "text", text: "Seller's delivery photo:" }, { type: "image_url", image_url: { url: deliveryPhoto } });
  const r = await meta.chatJSON<Mediation>({
    system: `You help a human mediator settle a dispute about a recyclables trade held in escrow. You do not decide.
Compare the listing photo, the delivery photo and both statements. Be neutral and factual; never insult either side.
recommendation: release (seller delivered as agreed), refund (not delivered / clearly not as listed), or split (partly delivered).
seller_share_pct: 100 for release, 0 for refund, otherwise your estimate of the share delivered.
evidence_summary ≤50 words; reasoning ≤60 words; confidence 0..1.`,
    user: content,
    name: "mediation",
    schema: {
      type: "object", additionalProperties: false,
      required: ["recommendation", "seller_share_pct", "evidence_summary", "reasoning", "confidence"],
      properties: {
        recommendation: { type: "string", enum: ["release", "refund", "split"] },
        seller_share_pct: { type: "number" }, evidence_summary: { type: "string" }, reasoning: { type: "string" }, confidence: { type: "number" },
      },
    },
  });
  const rec = ["release", "refund", "split"].includes(r.recommendation) ? r.recommendation : "split";
  const pct = rec === "release" ? 100 : rec === "refund" ? 0 : Math.max(1, Math.min(99, Math.round(Number(r.seller_share_pct) || 50)));
  return { recommendation: rec, seller_share_pct: pct, evidence_summary: String(r.evidence_summary ?? "").slice(0, 400), reasoning: String(r.reasoning ?? "").slice(0, 500), confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)) };
}
