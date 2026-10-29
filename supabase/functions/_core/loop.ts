// Loop — waste-to-value matching. Every waste stream finds the business that turns it into value:
// rice husk to a briquette maker, coffee pulp to a composter, PET to a recycler.
//   Assessment: Muse Spark identifies the waste and its condition, SAM 3.1 counts sacks or items,
//   and a one-time code written on paper in the photo proves the photo is fresh.
//   Pricing: never invented by a model. Buyers post bids (price per unit); the best eligible bid wins.
//   Settlement: escrow holds the buyer's ECOIN; the buyer's weighed intake decides what is paid.
//   Disputes: Muse Spark recommends, a person decides.
import type { MetaClient, ModelCallTrace } from "./meta.ts";
import { haversineM } from "./rules.ts";
import { countObjects, parseSamOutput } from "./sam.ts";

export type MaterialId =
  | "rice_husk" | "sawdust" | "maize_cobs" | "coffee_pulp" | "used_cooking_oil" | "food_waste"
  | "pet_bottles" | "plastic_jerrycans" | "cans" | "cardboard" | "e_waste";
export type Grade = "A" | "B" | "C";
export type Unit = "kg" | "items" | "litres";

export interface Material {
  id: MaterialId;
  title: string;
  unit: Unit;                // what is weighed and paid for
  sam: string;               // SAM 3.1 noun phrase counted in the photo
  counts: "sacks" | "items" | "containers";
  becomes: string[];         // value-added products
  buyers: string[];          // who buys it
  quality: string;           // what makes a lot grade A
}

export const MATERIALS: Record<MaterialId, Material> = {
  rice_husk: { id: "rice_husk", title: "Rice husk", unit: "kg", sam: "sack", counts: "sacks", becomes: ["fuel briquettes", "biochar", "poultry bedding"], buyers: ["briquette makers", "biochar producers", "poultry farms"], quality: "dry, free of soil and stones, not mouldy" },
  sawdust: { id: "sawdust", title: "Sawdust and wood shavings", unit: "kg", sam: "sack", counts: "sacks", becomes: ["fuel briquettes", "animal bedding", "mushroom substrate"], buyers: ["briquette makers", "farms", "mushroom growers"], quality: "dry, untreated wood, no paint or plastic" },
  maize_cobs: { id: "maize_cobs", title: "Maize cobs", unit: "kg", sam: "sack", counts: "sacks", becomes: ["fuel briquettes", "biochar"], buyers: ["briquette makers", "biochar producers"], quality: "dry, grain removed" },
  coffee_pulp: { id: "coffee_pulp", title: "Coffee pulp and husks", unit: "kg", sam: "sack", counts: "sacks", becomes: ["compost", "fuel briquettes"], buyers: ["composters", "briquette makers"], quality: "fresh or dried, no plastic mixed in" },
  used_cooking_oil: { id: "used_cooking_oil", title: "Used cooking oil", unit: "litres", sam: "plastic container", counts: "containers", becomes: ["biodiesel", "soap"], buyers: ["biodiesel makers", "soap makers"], quality: "strained, no water, no mixed fuels" },
  food_waste: { id: "food_waste", title: "Food and market waste", unit: "kg", sam: "sack", counts: "sacks", becomes: ["insect protein (black soldier fly)", "compost"], buyers: ["insect farms", "composters"], quality: "organic only, no plastic or glass" },
  pet_bottles: { id: "pet_bottles", title: "PET plastic bottles", unit: "items", sam: "plastic bottle", counts: "items", becomes: ["recycled PET flakes"], buyers: ["plastic recyclers"], quality: "sorted PET only, caps off, rinsed" },
  plastic_jerrycans: { id: "plastic_jerrycans", title: "Plastic jerrycans", unit: "items", sam: "plastic jerrycan", counts: "items", becomes: ["reusable storage containers", "reprocessed plastic"], buyers: ["container reusers", "plastic recyclers"], quality: "empty and clean; disclose the resin type when known; intact if sold for reuse" },
  cans: { id: "cans", title: "Aluminium cans", unit: "items", sam: "drink can", counts: "items", becomes: ["recycled aluminium"], buyers: ["scrap metal recyclers"], quality: "aluminium only, empty" },
  cardboard: { id: "cardboard", title: "Cardboard", unit: "kg", sam: "cardboard box", counts: "items", becomes: ["recycled paper"], buyers: ["paper recyclers"], quality: "dry, flattened, no wax coating" },
  e_waste: { id: "e_waste", title: "E-waste (phones, chargers, small electronics)", unit: "items", sam: "electronic device", counts: "items", becomes: ["recovered metals and parts"], buyers: ["licensed e-waste recyclers"], quality: "intact, batteries handled safely" },
};

const GRADE_RANK: Record<Grade, number> = { A: 0, B: 1, C: 2 };
export const gradeOk = (g: Grade | null, min: Grade) => g !== null && GRADE_RANK[g] <= GRADE_RANK[min];

/** A short code the seller writes on paper and puts in the photo; proves the photo was taken for this listing. */
export function newChallenge(): string {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no look-alikes (0/O, 1/I/L)
  const r = crypto.getRandomValues(new Uint8Array(4));
  return [...r].map((b) => A.charAt(b % A.length)).join("");
}
export const sameCode = (seen: string, want: string) => seen.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(want);

export interface Listing {
  id: string;
  seller: string;
  material: MaterialId;
  quantity: number;
  unit: Unit;
  price: number;          // seller's minimum price per unit (0 = none); the trade price is the buyer's bid
  grade: Grade | null;
  sam_count: number;
  challenge: string | null;
  photo_path: string | null;
  photo_sha256: string | null;
  photo_phash?: string | null;
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
  max_price: number;      // the buyer's bid, ECOIN per unit
  min_grade: Grade;
  lat: number | null;
  lng: number | null;
  radius_km: number;
  status: "open" | "filled" | "cancelled";
  created_at: string;
}

export type TradeStatus = "proposed" | "escrowed" | "delivered" | "released" | "disputed" | "refunded" | "settled" | "declined";

export interface Intake { accepted_quantity: number; grade: Grade | null; note: string; by: string; via: "whatsapp" | "web"; at: string }

export interface Trade {
  id: string;
  listing_id: string;
  demand_id: string;
  seller: string;
  buyer: string;
  material: MaterialId;
  quantity: number;
  unit: Unit;
  price: number;
  total: number;
  distance_km: number | null;
  status: TradeStatus;
  delivery_photo_path: string | null;
  intake: Intake | null;            // the buyer's weighed acceptance — the second witness
  intake_code_hash: string | null;  // one-time code the buyer uses on the web intake page
  dispute: { by: string; reason: string; at: string } | null;
  mediation: Mediation | null;
  decision: { outcome: "release" | "refund" | "split"; seller_share_pct: number; by: string; note: string; at: string } | null;
  history: Array<{ at: string; status: TradeStatus; note: string }>;
  created_at: string;
}

// ───────── assessment (AI identifies and grades; nobody's price comes from the model) ─────────

export interface LotObservation {
  identified_as: MaterialId | "other" | "unclear";
  matches_claim: "yes" | "no" | "unclear";
  condition_good: "yes" | "no" | "unclear";
  code_seen: string;
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
  outcome: "listed" | "needs_better_photo" | "rejected";
  reasons: string[];
  models?: ModelCallTrace[];
}

const LOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["identified_as", "matches_claim", "condition_good", "code_seen", "estimated_quantity", "possibly_ai_generated_or_edited", "confidence", "notes"],
  properties: {
    identified_as: { type: "string", enum: [...Object.keys(MATERIALS), "other", "unclear"] },
    matches_claim: { type: "string", enum: ["yes", "no", "unclear"] },
    condition_good: { type: "string", enum: ["yes", "no", "unclear"] },
    code_seen: { type: "string" },
    estimated_quantity: { type: "number" },
    possibly_ai_generated_or_edited: { type: "boolean" },
    confidence: { type: "number" },
    notes: { type: "string" },
  },
};

/** Pure rules from what the models saw. Grade = condition; quantity = what the photo supports. */
export function gradeLot(m: Material, claimed: number, samCount: number, o: LotObservation, challenge: string | null): Assessment {
  const reasons: string[] = [];
  const confident = o.confidence >= 0.7;
  const base = { observation: o, sam_count: samCount };
  if (o.matches_claim === "no" && confident) {
    const other = o.identified_as in MATERIALS ? MATERIALS[o.identified_as as MaterialId].title.toLowerCase() : "something else";
    return { ...base, grade: null, verified_quantity: 0, outcome: "rejected", reasons: [`The photo looks like ${other}, not ${m.title.toLowerCase()}.`] };
  }
  if (challenge && !sameCode(o.code_seen, challenge)) reasons.push(`The code ${challenge} isn't readable in the photo. Write it on paper and put it in the shot.`);
  if (o.matches_claim !== "yes") reasons.push(`Couldn't confirm the photo shows ${m.title.toLowerCase()}.`);
  if (o.possibly_ai_generated_or_edited) reasons.push("The photo may be AI-generated or edited.");
  let qty = claimed;
  if (m.unit === "items") {
    const seen = Math.max(samCount, Math.round(o.estimated_quantity || 0));
    if (seen === 0) reasons.push(`No ${m.sam}s could be found in the photo.`);
    qty = Math.min(claimed, seen);
    if (seen < claimed * 0.5) reasons.push(`The photo shows about ${seen}, not ${claimed}. Spread the lot out, or list it in parts.`);
  } else if (o.estimated_quantity > 0 && o.estimated_quantity < claimed * 0.3) {
    reasons.push(`The photo looks like about ${Math.round(o.estimated_quantity)} ${m.unit}, not ${claimed}. The buyer's scale decides the final amount.`);
  }
  if (reasons.length) return { ...base, grade: null, verified_quantity: qty, outcome: "needs_better_photo", reasons };
  const grade: Grade = o.condition_good === "yes" ? "A" : o.condition_good === "unclear" ? "B" : "C";
  return { ...base, grade, verified_quantity: qty, outcome: "listed", reasons: [`Grade ${grade} (${m.quality}). The buyer's scale sets the amount paid.`] };
}

export async function assessLot(meta: MetaClient, m: Material, claimed: number, photoDataUrl: string, challenge: string | null): Promise<Assessment> {
  const trace: ModelCallTrace[] = [];
  const previousOnCall = meta.onCall;
  meta.onCall = (event) => { trace.push(event); previousOnCall?.(event); };
  try {
    const [sam, obs] = await Promise.all([
      meta.canSegment ? meta.segment(photoDataUrl, m.sam).then((t) => countObjects(parseSamOutput(t))) : Promise.resolve(0),
      meta.chatJSON<LotObservation>({
        system: `You check a photo of waste offered for sale. The seller says: ${claimed} ${m.unit} of ${m.title}.
Answer only from the photo; use "unclear" when unsure.
identified_as: which waste this is (one of the listed ids), "other" or "unclear".
matches_claim: does it show ${m.title.toLowerCase()}?
condition_good: does it look ${m.quality}?
code_seen: any short code written on paper in the photo, exactly as written, or "".
estimated_quantity: your estimate in ${m.unit} (count ${m.counts} if that is all you can see).
possibly_ai_generated_or_edited: true only for clear signs. confidence: 0..1. notes: ≤40 words, plain, no accusations.`,
        user: [{ type: "text", text: "Lot photo:" }, { type: "image_url", image_url: { url: photoDataUrl } }],
        name: "lot_observation",
        schema: LOT_SCHEMA,
      }),
    ]);
    const tri = (v: unknown) => (v === "yes" || v === "no" ? v : "unclear") as "yes" | "no" | "unclear";
    const o: LotObservation = {
      identified_as: (obs.identified_as in MATERIALS || obs.identified_as === "other") ? obs.identified_as : "unclear",
      matches_claim: tri(obs.matches_claim),
      condition_good: tri(obs.condition_good),
      code_seen: String(obs.code_seen ?? "").slice(0, 40),
      estimated_quantity: Math.max(0, Number(obs.estimated_quantity) || 0),
      possibly_ai_generated_or_edited: obs.possibly_ai_generated_or_edited === true,
      confidence: Math.max(0, Math.min(1, Number(obs.confidence) || 0)),
      notes: String(obs.notes ?? "").slice(0, 300),
    };
    return { ...gradeLot(m, claimed, sam, o, challenge), models: trace };
    } finally {
    meta.onCall = previousOnCall;
  }
}

// ───────── matching: buyers' bids compete ─────────

export function distanceKm(a: { lat: number | null; lng: number | null }, b: { lat: number | null; lng: number | null }): number | null {
  if (a.lat === null || a.lng === null || b.lat === null || b.lng === null) return null;
  return Math.round(haversineM({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) / 100) / 10;
}

/** Best open bid for a listing: same waste, grade good enough, bid at or above the seller's minimum, within the buyer's
 *  radius, not the seller themself. Ranked by bid (best for the seller), then distance. The trade price = that bid. */
export function bestMatch(l: Listing, demands: Demand[]): { demand: Demand; quantity: number; distance_km: number | null; price: number } | null {
  const ok = demands
    .filter((d) => d.status === "open" && d.material === l.material && d.buyer !== l.seller && d.max_price >= l.price && d.quantity > 0 && gradeOk(l.grade, d.min_grade ?? "C"))
    .map((d) => ({ d, km: distanceKm(l, d) }))
    .filter(({ d, km }) => km === null || km <= d.radius_km)
    .sort((a, b) => b.d.max_price - a.d.max_price || (a.km ?? 1e9) - (b.km ?? 1e9));
  if (!ok.length) return null;
  return { demand: ok[0].d, quantity: Math.min(l.quantity, ok[0].d.quantity), distance_km: ok[0].km, price: ok[0].d.max_price };
}

/** Top matched bids (for the agent's bidding round). */
export function rankBids(l: Listing, demands: Demand[], n = 3) {
  const out: Array<{ demand: Demand; distance_km: number | null }> = [];
  let pool = demands;
  for (let i = 0; i < n; i++) {
    const m = bestMatch(l, pool);
    if (!m) break;
    out.push({ demand: m.demand, distance_km: m.distance_km });
    pool = pool.filter((d) => d.id !== m.demand.id);
  }
  return out;
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
