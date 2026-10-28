// ECOIN ledger: append-only, double-entry, hash-chained.
//   • ECOIN is minted only by a verified climate action ("reward") — no proof, no token.
//   • Every other movement (trade, escrow, payment, fee, reserve) is a set of legs that sums to zero.
//   • Each entry commits to the one before it, so altering or deleting any past entry breaks every
//     hash after it. Anyone can re-check the chain in a browser (web/ledger.html).
// The database applies the same rules and the same hash in SQL (ledger_post in the migration).

export const GENESIS = "0".repeat(64);

export type EntryKind =
  | "reward"   // minted for a verified climate action
  | "deposit"  // test funding for business accounts in this demo (clearly labelled)
  | "trade"    // Loop: escrow → seller
  | "escrow"   // Loop: buyer → escrow, or escrow → buyer on refund
  | "payment"  // Glance: customer → shop
  | "fee"      // ECO's revenue share of a fee
  | "reserve"; // the Reserve's share of a fee

export const MINT_KINDS: EntryKind[] = ["reward", "deposit"];

export const SYSTEM = {
  escrow: "eco_escrow",
  treasury: "eco_treasury",
  reserve: "eco_reserve",
} as const;

export interface LedgerEntry {
  seq: number;
  prev_hash: string;
  hash: string;
  account_id: string;
  amount: number;   // whole ECOIN; + credit, − debit
  kind: EntryKind;
  ref: string | null; // claim, trade or payment id
  memo: string;
  at: string;       // ISO-8601 UTC with milliseconds
}

export type UnsignedEntry = Omit<LedgerEntry, "hash">;
export interface Leg { account_id: string; amount: number; kind: EntryKind }

export function canonical(e: UnsignedEntry): string {
  return [e.seq, e.prev_hash, e.account_id, e.amount, e.kind, e.ref ?? "", e.memo, e.at].join("|");
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const buf = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function seal(e: UnsignedEntry): Promise<LedgerEntry> {
  return { ...e, hash: await sha256Hex(canonical(e)) };
}

/** The posting rules shared by every store. Returns an error message, or null if the legs are valid. */
/**
 * Escrow is one pooled account, so it is also tracked per trade: escrow moves need the trade id as ref,
 * a trade is locked at most once, and a payout can never exceed what that trade locked. This is what stops
 * a repeated or concurrent intake from paying twice out of another trade's collateral.
 */
export function checkLegs(legs: Leg[], balanceOf: (account: string) => number, ref: string | null = null, escrowHeld: (ref: string) => number = () => 0): string | null {
  if (!legs.length) return "no legs";
  for (const l of legs) if (!Number.isInteger(l.amount) || l.amount === 0) return "amounts must be non-zero whole ECOIN";
  const mint = legs.every((l) => MINT_KINDS.includes(l.kind));
  if (mint) {
    if (legs.some((l) => l.amount < 0)) return "minting cannot debit";
  } else {
    if (legs.some((l) => MINT_KINDS.includes(l.kind))) return "mint kinds cannot be mixed with transfers";
    if (legs.reduce((s, l) => s + l.amount, 0) !== 0) return "transfer legs must sum to zero";
  }
  const net = new Map<string, number>();
  for (const l of legs) net.set(l.account_id, (net.get(l.account_id) ?? 0) + l.amount);
  for (const [a, n] of net) if (n < 0 && balanceOf(a) + n < 0) return `insufficient ECOIN in ${a}`;
  const e = net.get(SYSTEM.escrow);
  if (e !== undefined) {
    if (!ref) return "escrow moves need a trade reference";
    const held = escrowHeld(ref);
    if (e > 0 && held > 0) return "this trade is already in escrow";
    if (e < 0 && held + e < 0) return "escrow for this trade is already settled";
  }
  return null;
}

/** Checks the chain in order. Returns the first broken seq, or null if intact. */
export async function verifyChain(entries: LedgerEntry[]): Promise<{ ok: boolean; brokenAt: number | null; reason?: string }> {
  let prev = GENESIS;
  let expectSeq = 1;
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (e.seq !== expectSeq) return { ok: false, brokenAt: e.seq, reason: `missing entry before #${e.seq}` };
    if (e.prev_hash !== prev) return { ok: false, brokenAt: e.seq, reason: `#${e.seq} does not point to the previous entry` };
    if ((await sha256Hex(canonical(e))) !== e.hash) return { ok: false, brokenAt: e.seq, reason: `#${e.seq} was altered` };
    prev = e.hash;
    expectSeq++;
  }
  return { ok: true, brokenAt: null };
}

/** Supply audit: every ECOIN in existence traces back to a reward or a labelled deposit. */
export function supply(entries: LedgerEntry[]) {
  const minted = entries.filter((e) => e.kind === "reward").reduce((s, e) => s + e.amount, 0);
  const deposits = entries.filter((e) => e.kind === "deposit").reduce((s, e) => s + e.amount, 0);
  const total = entries.reduce((s, e) => s + e.amount, 0);
  return { minted, deposits, total, balanced: total === minted + deposits };
}
