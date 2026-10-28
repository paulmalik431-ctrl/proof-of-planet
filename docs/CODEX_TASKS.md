# Task board — Claude + Codex

Deadline: submit by **Nov 4, 6 PM Nairobi** (hard deadline Nov 5, 5 AM Nairobi). Code freeze **Nov 3**.
Read `AGENTS.md` first. Each task is self-contained, offline-testable and has acceptance criteria.

**Cut-line (agreed with the strategy review):** no Proof Card, follow-ups or bidding expansion until a real-model claim survives intake, partial settlement and duplicate replay end to end.

| ID | Owner | Task | Priority |
|---|---|---|---|
| C6 | Codex | Waste-lot evaluation protocol + runner (protocol committed first) | 1st |
| C1 | Codex | Near-duplicate photo detection (perceptual hash) | 2nd |
| C4 | Codex | Cheat lab page (sandbox, fixed cases, reuses C6) | 3rd |
| C3 | Codex | Daily ledger fingerprint published to the repo | 4th |
| C5 | Codex | Scheduled follow-ups (only nudges toward intake) | 5th |
| C2 | Codex | Proof Card (Muse Image art + verified figures) | last |
| K0 | Claude | Escrow invariant tests: repeated intake, wrong buyer, retries, partial acceptance | ✅ done |
| K1 | Claude | Deploy; prove Muse Spark Open tool calls + SAM 3.1 live | P0 |
| K2 | Claude | Agent bidding round across matched buyers | P1 |
| K3 | Claude | Receipt step trace (agent steps, model IDs, latency) | P0 |
| K4 | Claude | Review + merge Codex PRs; site copy; video/X assets | P0 |

---

## C1 · Near-duplicate photo detection (P0)
Exact SHA-256 already blocks identical files. Add a perceptual hash so **cropped, resized or re-compressed** copies of a photo used in another claim or listing are caught.
- `supabase/functions/_core/phash.ts`: `dHash(gray: Uint8Array, width, height): string` (64-bit difference hash, hex) on a grayscale image resized to 9×8 by box-averaging; `hamming(a, b): number`. Pure TS, no runtime APIs.
- Decoding is runtime-specific: add `_shared/decode.ts` (Deno, `npm:jpeg-js@0.4.4` + PNG via `npm:upng-js` if simple) and a Bun-side decoder for tests (add `jpeg-js` as a devDependency). Core receives a decoder via `AgentDeps.decodeImage?: (bytes, mime) => {gray, width, height} | null`; if absent or decoding fails, skip the check (fail open for the check, never pay on error elsewhere).
- Store: add `phash` to `evidence` and listings (`photo_phash`), `Store.photoNearDuplicate(phash, ref, maxDistance = 6): Promise<string | null>` (returns the other claim/listing id). Implement in `MemoryStore`, `SupabaseStore` (fetch candidates by recency is fine; ≤ 2,000 rows) and the migration.
- Wire in: Witness `verifyClaim` context `duplicatePhoto` becomes true for near-duplicates too (reason text says "near-identical to a photo used in another claim"); Loop `publish_listing` rejects near-duplicates like exact ones.
- Tests: real JPEG fixtures generated in-test (draw a gradient/noise image, encode with jpeg-js at q90; derive crop 90%, resize 50%, re-encode q40) → distance ≤ 6; an unrelated image → distance > 20; end-to-end agent test: a re-compressed copy reused for a second claim is contradicted.

## C2 · Proof Card (P1) — for the Best Creative prize (Muse Image in the experience)
Each verified outcome (Witness claim `consistent`, Loop trade `released`) gets a shareable card.
- `_core/proofcard.ts`: `proofCardPrompt(kind, facts)` builds a Muse Image prompt for an artwork inspired by the outcome (e.g. "rice husk becoming clean-burning briquettes, warm editorial illustration, no text"); **the art never depicts evidence and contains no numbers**. `makeProofCard(meta, store, ref)` calls `meta.generateImage`, saves to storage, records `card_path` on the claim/trade. Cost cap: one card per outcome, skip if `card_path` exists; never block settlement on failure.
- `web/card.html?claim=<id>` or `?trade=<id>`: the art full-bleed with an overlay of **real verified figures** from the public views (e.g. "560 kg rice husk → briquettes · verified by the buyer's scale · ECO · Proof of Planet"), a clear "AI art" label, a link to the receipt/Evidence File, and Open Graph tags so it previews on WhatsApp/X. Mobile-first, 1080×1350 safe area.
- Agent: after a verified outcome, the reply includes the card link (only if generated).
- Tests: prompt contains no digits; `makeProofCard` is idempotent; failure leaves settlement untouched (use `fakeMeta`, add an `/images/generations` route to it).

## C3 · Daily ledger fingerprint (P1)
Whoever controls the database could rewrite history; publishing the chain head outside it limits that.
- `scripts/anchor.ts`: fetch the latest `public_ledger` row (`order=seq.desc&limit=1`) via REST (env `SUPABASE_URL`, `SUPABASE_ANON_KEY`), append `{seq, hash, at, anchored_at}` to `anchors/ledger-heads.jsonl` if new.
- `.github/workflows/anchor.yml`: daily cron + manual dispatch; commits the file with a bot identity; needs `contents: write`.
- `web/ledger.html`: load `anchors/ledger-heads.jsonl` from the repo (raw GitHub URL from `REPO_URL`) and show "Last published fingerprint: #seq, matches ✓ / differs ✗" after the chain check.
- Tests: the anchor script logic as a pure function (`nextAnchor(existingLines, head)`), plus the comparison function used by the page.

## C4 · Cheat lab (P2) — creative + viral hook
`web/lab.html`: visitors pick a fixed attack and watch it fail, with the real reasons.
- Cases (images committed under `evals/lab/`, generated once by `scripts/ghost-audit.ts` with Muse Image, plus 2 real photos): exact replay, cropped copy, missing one-time code, wrong material, AI-generated pile, intake larger than escrow, zero intake.
- A `lab` edge function runs the case through the **real verifier/rules on an in-memory store** (never the production ledger) and caches each case's result for 24 h in a `lab_results` table (cost cap). Shows: what the model observed, which rule fired, "would a reward be paid? no".
- Rate limit per IP-less session (use the same session id scheme as `try.html`); daily cap env `LAB_DAILY_CAP` (default 200).
- Tests: each case's rule outcome with `fakeMeta`.

## C5 · Scheduled follow-ups (P2) — agent autonomy
`supabase/functions/followups/index.ts` (cron via `supabase/config.toml` schedule or a GitHub Actions cron hitting it with a secret header):
- Tree plantings verified ≥ 25 days ago with no survival claim → message: "Your tree is due its 30-day check…".
- Trades `proposed` > 24 h → nudge the buyer; `escrowed` > 72 h without delivery → nudge the seller; `delivered` > 48 h without intake → nudge the buyer with the intake link.
- At most one nudge per item per 24 h (store `last_nudged_at`). Pure selection logic in `_core/followups.ts` with tests.

## C6 · Waste-lot evaluation (P1) — answers "what's your false-accept rate?"
- `evals/PROTOCOL.md`: written and committed **before** running. Labels, cases, metrics (listed vs. not, identification accuracy, false accept of fakes, false reject of real lots, count error vs. human count), model versions, cost per case.
- `evals/lots/labels.json` schema `{id, file, material, claimed_qty, code, expected: "listed"|"needs_better_photo"|"rejected", human_count}`; `scripts/eval-lots.ts` runs `assessLot` on each (real models via `clientFromEnv`), writes `evals/lots/results.json` and a Markdown table into `evals/README.md` with a confusion matrix, and supports `--provider=meta|baseten` so Muse Spark 1.3 and Muse Spark Open can be compared on the same cases.
- No images of identifiable people. Tests: metric computation is a pure function with unit tests.
