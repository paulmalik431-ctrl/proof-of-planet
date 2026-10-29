import { expect, test } from "bun:test";
import { compareAnchor, nextAnchor, parseAnchors } from "../web/js/anchor.js";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const at = "2026-10-28T12:00:00Z";
const head = { seq: 4, hash: hashA, at };
const line = JSON.stringify({ ...head, anchored_at: at }) + "\n";

test("nextAnchor appends only new, increasing ledger heads", () => {
  expect(nextAnchor("", head, at)).toBe(line);
  expect(nextAnchor(line, head, at)).toBeNull();
  expect(() => nextAnchor(line, { ...head, hash: hashB }, at)).toThrow("did not advance");
  expect(() => nextAnchor(line, { ...head, seq: 3 }, at)).toThrow("did not advance");
  expect(JSON.parse(nextAnchor(line, { ...head, seq: 5 }, at)!).seq).toBe(5);
});

test("parseAnchors validates JSONL rows", () => {
  expect(parseAnchors(line)).toHaveLength(1);
  expect(() => parseAnchors("{}\n")).toThrow("Invalid ledger anchor row");
});

test("comparison checks the anchored sequence hash against the verified public rows", () => {
  const anchor = JSON.parse(line);
  expect(compareAnchor(anchor, [{ seq: 4, hash: hashA }])).toBe("matches");
  expect(compareAnchor(anchor, [{ seq: 4, hash: hashB }])).toBe("differs");
  expect(compareAnchor(anchor, [{ seq: 5, hash: hashA }])).toBe("not-found");
  expect(compareAnchor(null, [])).toBe("missing");
});

