// ECOIN ledger: append-only and hash-chained. Each entry commits to the one before it,
// so changing or deleting any past entry breaks every hash after it. Anyone can re-check
// the whole chain in a browser (web/ledger.html) without trusting ECO's server.
// The database computes the same hash in SQL (supabase/migrations, ledger_append).

export const GENESIS = "0".repeat(64);

export interface LedgerEntry {
  seq: number;
  prev_hash: string;
  hash: string;
  account_id: string;
  amount: number;        // whole ECOIN; positive = credit
  kind: "reward" | "spend" | "adjustment";
  claim_id: string | null;
  memo: string;
  at: string;            // ISO-8601 UTC with milliseconds, e.g. 2026-10-26T18:00:00.000Z
}

export type UnsignedEntry = Omit<LedgerEntry, "hash">;

export function canonical(e: UnsignedEntry): string {
  return [e.seq, e.prev_hash, e.account_id, e.amount, e.kind, e.claim_id ?? "", e.memo, e.at].join("|");
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const buf = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function seal(e: UnsignedEntry): Promise<LedgerEntry> {
  return { ...e, hash: await sha256Hex(canonical(e)) };
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

export function utcIso(d: Date): string {
  return d.toISOString(); // always ...sss Z
}
