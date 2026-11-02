// Proof Card: a shareable card for every verified outcome. Muse Image paints the art; the figures printed on the
// card come only from the ledger and the Evidence File. The art never depicts evidence and carries no numbers,
// so it can't be mistaken for proof; the card says "AI art" and links to the real evidence.
import { MATERIALS, type MaterialId } from "./loop.ts";
import { PROTOCOLS, type ProtocolId } from "./protocols.ts";

export type CardSubject =
  | { kind: "claim"; protocol: ProtocolId }
  | { kind: "trade"; material: MaterialId };

const STYLE = "warm editorial illustration in layered paper-cut style, East African light, rich greens, ochre and sky blue, hopeful and dignified, " +
  "no people's faces, no text, no letters, no numbers, no logos, no watermarks, portrait composition";

export function proofCardPrompt(s: CardSubject): string {
  if (s.kind === "claim") {
    const scene: Record<ProtocolId, string> = {
      tree_planting: "a young tree taking root in rich red soil at sunrise, roots glowing softly underground, birds returning",
      tree_survival: "a sturdy young tree thriving a season later, new leaves catching the light, a small shaded garden around it",
      cleanup: "a riverside path that has just been cleared of litter, clean water reflecting the sky, wildflowers along the bank",
      recycling: "bottles and cans flowing into a bright recycling stream that turns into new useful objects",
    };
    return `${scene[s.protocol]}. ${STYLE}`;
  }
  const m = MATERIALS[s.material];
  return `${m.title.toLowerCase()} being transformed into ${m.becomes[0]}, shown as a gentle journey from a farm or street to a small local workshop, a circle of value. ${STYLE}`;
}

export interface CardFacts { title: string; lines: string[]; evidence: string; }

/** The printed figures. Every number here comes from stored, verified records — never from a model. */
export function claimFacts(c: { id: string; protocol: ProtocolId; reward: number; verified_at: string | null }, publicUrl: string): CardFacts {
  const p = PROTOCOLS[c.protocol];
  return {
    title: `${p.title}, verified`,
    lines: [`${c.reward} ECOIN minted for this action`, `Verified ${c.verified_at ? c.verified_at.slice(0, 10) : ""}`.trim(), "Checked by Meta AI · decided by fixed rules"],
    evidence: `${publicUrl}/claim.html?id=${c.id}`,
  };
}

export function tradeFacts(t: { id: string; material: MaterialId; unit: string; intake: { accepted_quantity: number } | null; price: number }, publicUrl: string): CardFacts {
  const m = MATERIALS[t.material];
  const q = t.intake?.accepted_quantity ?? 0;
  return {
    title: `${m.title} → ${m.becomes[0]}`,
    lines: [`${q} ${t.unit === "items" ? "items" : t.unit} weighed and accepted by the buyer`, `Paid through escrow at the buyer's bid of ${t.price} ECOIN per ${t.unit === "items" ? "item" : t.unit}`, "Waste turned into value, on the public ledger"],
    evidence: `${publicUrl}/trade.html?id=${t.id}`,
  };
}
