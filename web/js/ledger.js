// supabase/functions/_core/ledger.ts
var GENESIS = "0".repeat(64);
var MINT_KINDS = ["reward", "deposit"];
var SYSTEM = {
  escrow: "eco_escrow",
  treasury: "eco_treasury",
  reserve: "eco_reserve"
};
function canonical(e) {
  return [e.seq, e.prev_hash, e.account_id, e.amount, e.kind, e.ref ?? "", e.memo, e.at].join("|");
}
async function sha256Hex(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function seal(e) {
  return { ...e, hash: await sha256Hex(canonical(e)) };
}
function checkLegs(legs, balanceOf) {
  if (!legs.length)
    return "no legs";
  for (const l of legs)
    if (!Number.isInteger(l.amount) || l.amount === 0)
      return "amounts must be non-zero whole ECOIN";
  const mint = legs.every((l) => MINT_KINDS.includes(l.kind));
  if (mint) {
    if (legs.some((l) => l.amount < 0))
      return "minting cannot debit";
  } else {
    if (legs.some((l) => MINT_KINDS.includes(l.kind)))
      return "mint kinds cannot be mixed with transfers";
    if (legs.reduce((s, l) => s + l.amount, 0) !== 0)
      return "transfer legs must sum to zero";
  }
  const net = new Map;
  for (const l of legs)
    net.set(l.account_id, (net.get(l.account_id) ?? 0) + l.amount);
  for (const [a, n] of net)
    if (n < 0 && balanceOf(a) + n < 0)
      return `insufficient ECOIN in ${a}`;
  return null;
}
async function verifyChain(entries) {
  let prev = GENESIS;
  let expectSeq = 1;
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (e.seq !== expectSeq)
      return { ok: false, brokenAt: e.seq, reason: `missing entry before #${e.seq}` };
    if (e.prev_hash !== prev)
      return { ok: false, brokenAt: e.seq, reason: `#${e.seq} does not point to the previous entry` };
    if (await sha256Hex(canonical(e)) !== e.hash)
      return { ok: false, brokenAt: e.seq, reason: `#${e.seq} was altered` };
    prev = e.hash;
    expectSeq++;
  }
  return { ok: true, brokenAt: null };
}
function supply(entries) {
  const minted = entries.filter((e) => e.kind === "reward").reduce((s, e) => s + e.amount, 0);
  const deposits = entries.filter((e) => e.kind === "deposit").reduce((s, e) => s + e.amount, 0);
  const total = entries.reduce((s, e) => s + e.amount, 0);
  return { minted, deposits, total, balanced: total === minted + deposits };
}
export {
  GENESIS,
  MINT_KINDS,
  SYSTEM,
  canonical,
  checkLegs,
  seal,
  sha256Hex,
  supply,
  verifyChain
};
