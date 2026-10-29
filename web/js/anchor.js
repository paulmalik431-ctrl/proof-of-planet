export function parseAnchors(existingLines) {
  return String(existingLines ?? "").split(/\r?\n/).filter(Boolean).map((line) => {
    const row = JSON.parse(line);
    if (!Number.isSafeInteger(row.seq) || row.seq < 1 || !/^[0-9a-f]{64}$/i.test(row.hash)
      || typeof row.at !== "string" || typeof row.anchored_at !== "string") {
      throw new Error("Invalid ledger anchor row");
    }
    return row;
  });
}

/** Returns one JSONL line for a new monotonically advancing ledger head, or null if unchanged. */
export function nextAnchor(existingLines, head, anchoredAt = new Date().toISOString()) {
  if (!head || !Number.isSafeInteger(Number(head.seq)) || Number(head.seq) < 1 || !/^[0-9a-f]{64}$/i.test(head.hash) || typeof head.at !== "string") {
    throw new Error("Invalid public ledger head");
  }
  const rows = parseAnchors(existingLines);
  const last = rows.at(-1);
  const seq = Number(head.seq);
  if (last && seq === last.seq && head.hash.toLowerCase() === last.hash.toLowerCase()) return null;
  if (last && seq <= last.seq) throw new Error("Ledger head did not advance consistently");
  return JSON.stringify({ seq, hash: head.hash.toLowerCase(), at: head.at, anchored_at: anchoredAt }) + "\n";
}

/** Compare a GitHub-published fingerprint with the corresponding public-ledger row. */
export function compareAnchor(anchor, entries) {
  if (!anchor) return "missing";
  const row = entries.find((entry) => Number(entry.seq) === Number(anchor.seq));
  if (!row) return "not-found";
  return String(row.hash).toLowerCase() === String(anchor.hash).toLowerCase() ? "matches" : "differs";
}

