// supabase/functions/_core/ledger.ts
var GENESIS = "0".repeat(64);
function canonical(e) {
  return [e.seq, e.prev_hash, e.account_id, e.amount, e.kind, e.claim_id ?? "", e.memo, e.at].join("|");
}
async function sha256Hex(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function seal(e) {
  return { ...e, hash: await sha256Hex(canonical(e)) };
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
function utcIso(d) {
  return d.toISOString();
}
export {
  GENESIS,
  canonical,
  seal,
  sha256Hex,
  utcIso,
  verifyChain
};
