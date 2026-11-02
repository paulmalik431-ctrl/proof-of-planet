// Scout: a photo arrives with no open claim or listing. Muse Spark says what it shows; plain code turns that
// into the next step — start a climate-action claim, offer the waste to the businesses that turn it into value,
// or explain why the photo can't be used. Scout never lists, prices or pays anything: it only routes.
import type { MetaClient } from "./meta.ts";
import { MATERIALS, type MaterialId } from "./loop.ts";
import { PROTOCOLS, STARTABLE, type ProtocolId } from "./protocols.ts";

export interface ScoutObservation {
  category: "climate_action" | "waste_lot" | "not_relevant" | "unclear";
  action: ProtocolId | "none";
  material: MaterialId | "other" | "none";
  other_material: string;          // when material = "other": what it is, in a few words
  looks_usable: "yes" | "no" | "unclear";
  people_identifiable: boolean;
  possibly_ai_generated_or_edited: boolean;
  confidence: number;
  notes: string;
}

export interface ScoutAdvice {
  outcome: "start_action" | "offer_to_sell" | "advise_only" | "rejected";
  observation: ScoutObservation;
  protocol?: ProtocolId;
  material?: MaterialId;
  value_chains?: string[];
  buyers?: string[];
  open_bids?: number;
  message: string;                 // what the agent should tell the person / do next
}

const SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: ["climate_action", "waste_lot", "not_relevant", "unclear"] },
    action: { type: "string", enum: [...STARTABLE, "none"] },
    material: { type: "string", enum: [...Object.keys(MATERIALS), "other", "none"] },
    other_material: { type: "string" },
    looks_usable: { type: "string", enum: ["yes", "no", "unclear"] },
    people_identifiable: { type: "boolean" },
    possibly_ai_generated_or_edited: { type: "boolean" },
    confidence: { type: "number" },
    notes: { type: "string" },
  },
  required: ["category", "action", "material", "looks_usable", "confidence", "notes"],
};

const MIN_CONFIDENCE = 0.6;

export async function scoutPhoto(meta: MetaClient, photoDataUrl: string, caption = ""): Promise<ScoutObservation> {
  const o = await meta.chatJSON<Partial<ScoutObservation>>({
    system: `You look at one photo sent to ECO, a climate-action and waste-to-value service. Say only what the photo shows.
category: "climate_action" if it shows a climate action just done (${STARTABLE.map((id) => `${id}: ${PROTOCOLS[id].title}`).join("; ")});
Litter or rubbish lying around a public place (street, beach, river bank, market) is climate_action with action "cleanup": it is the BEFORE photo of a cleanup.
"waste_lot" if it shows sorted or collected waste or by-products someone could sell to a business that turns them into value;
"not_relevant" for anything else (selfies, documents, screenshots, food on a plate…); "unclear" if you can't tell.
action: the matching action id, or "none". material: the matching waste id (${Object.values(MATERIALS).map((m) => `${m.id} = ${m.title}`).join("; ")}),
"other" for a different useful waste (then name it in other_material, e.g. "cow dung", "coconut husks", "scrap iron"), or "none".
looks_usable: is it in a usable state (dry, sorted, not contaminated) for that action or waste?
people_identifiable: true if a person's face is clearly visible. possibly_ai_generated_or_edited: true only for clear signs.
confidence 0..1. notes: ≤30 words, plain, kind, no accusations.${caption ? `\nThe sender's caption: "${caption.slice(0, 200)}"` : ""}`,
    user: [{ type: "text", text: "Photo:" }, { type: "image_url", image_url: { url: photoDataUrl } }],
    name: "photo_scout",
    schema: SCHEMA,
  });
  const cat = ["climate_action", "waste_lot", "not_relevant", "unclear"].includes(String(o.category)) ? o.category! : "unclear";
  return {
    category: cat,
    action: (STARTABLE as string[]).includes(String(o.action)) ? (o.action as ProtocolId) : "none",
    material: o.material && (o.material in MATERIALS || o.material === "other") ? o.material : "none",
    other_material: String(o.other_material ?? "").slice(0, 60),
    looks_usable: o.looks_usable === "yes" || o.looks_usable === "no" ? o.looks_usable : "unclear",
    people_identifiable: o.people_identifiable === true,
    possibly_ai_generated_or_edited: o.possibly_ai_generated_or_edited === true,
    confidence: Math.max(0, Math.min(1, Number(o.confidence) || 0)),
    notes: String(o.notes ?? "").slice(0, 300),
  };
}

/** Fixed rules: what to do with what the model saw. `openBids` counts buyers bidding now for a material. */
export function adviseFromScout(o: ScoutObservation, openBids: (m: MaterialId) => number): ScoutAdvice {
  if (o.possibly_ai_generated_or_edited) {
    return { outcome: "rejected", observation: o, message: "This photo may be AI-made or edited, so it can't be used as evidence. Please send a fresh photo taken with your phone camera." };
  }
  if (o.confidence < MIN_CONFIDENCE || o.category === "unclear") {
    return { outcome: "advise_only", observation: o, message: `I couldn't tell clearly what this shows (${o.notes || "unclear photo"}). Tell me what it is, or send a clearer photo in daylight.` };
  }
  if (o.category === "climate_action" && o.action !== "none") {
    const p = PROTOCOLS[o.action];
    return {
      outcome: "start_action", observation: o, protocol: o.action,
      message: `It looks like ${p.title.toLowerCase()}. Call start_action with action "${o.action}" now (this photo will be attached), then ask for whatever is still missing.${o.people_identifiable ? " Mention that photos become public, so a retake without faces is better." : ""}`,
    };
  }
  if (o.category === "waste_lot" && o.material !== "none" && o.material !== "other") {
    const m = MATERIALS[o.material];
    const bids = openBids(o.material);
    return {
      outcome: "offer_to_sell", observation: o, material: o.material, value_chains: m.becomes, buyers: m.buyers, open_bids: bids,
      message: `It looks like ${m.title.toLowerCase()}${o.looks_usable === "no" ? ` (it may need to be ${m.quality} to sell well)` : ""}. It can become ${m.becomes.join(", ")} for ${m.buyers.join(", ")}. ${bids ? `${bids} buyer${bids > 1 ? "s are" : " is"} bidding for it right now.` : "No buyer is bidding yet; listing it alerts buyers nearby."} Ask if they want to sell and how much (${m.unit}); if yes, call sell_waste — the listing needs a new photo with the one-time code, so this photo is not reused.`,
    };
  }
  if (o.category === "waste_lot" && o.material === "other") {
    return {
      outcome: "advise_only", observation: o,
      message: `It looks like ${o.other_material || "a kind of waste"} that ECO can't trade yet. Tell them honestly, and share one practical, local way it is commonly put to use; do not promise a buyer or a price.`,
    };
  }
  return { outcome: "rejected", observation: o, message: `This photo doesn't show a climate action or waste to trade (${o.notes || "not relevant"}). Explain kindly what ECO can use: a planted tree, a cleanup before/after, sorted recyclables, or a waste lot to sell.` };
}
