# Handoff to Codex — Oct 28, 2026

Claude is pausing to save credits. Codex continues from here. Read `AGENTS.md` first; its rules still apply.

## Live now
- Supabase project `cczjirklcpcgcdskxosp` (eu-west-1). DB migrated; functions `whatsapp`, `simulate`, `atlas`, `intake` deployed.
  Pushing to `main` with changes under `supabase/**` redeploys automatically (`.github/workflows/supabase.yml`).
- Site: https://paulmalik431-ctrl.github.io/proof-of-planet/ (GitHub Pages via `ci.yml`). `web/config.js` is filled.
- Function secrets set: `MODEL_API_KEY` (Meta), `BASETEN_API_KEY`. Not yet: WhatsApp vars, `OPS_PHONES`.
- Tests: 56 passing (`bun test`). K0 (escrow per trade, ledger-enforced) is done.

## What the first live runs showed (Muse Spark 1.3 + SAM 3.1)
1. Agent conversation works, in Swahili, ~3.5–7 s per turn.
2. Witness ran end to end: Spark noticed a snowy photo claimed from Nairobi → "unresolved", nothing paid. Reused photo → "contradicted". Good.
3. **Fixed in the last commit:** empty replies. Muse Spark 1.3 is a reasoning model; `max_tokens: 600` was all spent on reasoning
   (`finish: "length"`, `reasoning_tokens: 598`). `MetaClient.chat` now sends `max_tokens >= 4000`. Also accepts content as parts.
   **Verify first:** run a fresh simulator session (below) and confirm the reply after `verify_claim` comes from the model, not the
   English fallback in `describeResult` (agent.ts).
4. **Open bug (do next): SAM 3.1 always returns 0.** Function logs show `sam_zero {"phrase":"sapling","raw":""}`, i.e.
   `MetaClient.segment` returns an empty string — `collectSseText` (sam.ts) doesn't recognise the live SSE event types.
   Steps: in `segment`, when the collected text is empty, `console.log` the first ~1500 chars of the raw response body; deploy;
   run one claim; read the log (Supabase → Edge Functions → simulate → Logs, search `sam_`); update `collectSseText` /
   `parseSamOutput` to the real format; add a test with the real captured body (no secrets in it). Also consider the prompt
   `"young tree"` instead of `"sapling"`.
5. Latency: the location turn that triggers verification took 20–35 s. After 3–4 are fixed, measure again; if still > 15 s,
   run SAM and the Spark observation in parallel (they are independent) — see `verify.ts`.

## How to test live (no secrets needed)
POST `https://cczjirklcpcgcdskxosp.supabase.co/functions/v1/simulate` with JSON
`{"session":"<8-40 alnum, new each run>","persona":"person","text":"yes"}`, then `{"text":"I planted a tree"}`, then
`{"image":"<base64 jpeg>","mime":"image/jpeg"}`, then `{"lat":-1.29,"lng":36.82}`. Use a **new photo each run** (the same photo is
correctly rejected as reused). Results are public at `/rest/v1/public_checks` (anon key is in `web/config.js`).

## Then, in order
- C6 → C1 → C4 → C3 → C5 → C2 per `docs/CODEX_TASKS.md` (Codex), plus Claude's open items you may take: K3 receipt step trace,
  K2 bidding round. Cut-line in `CODEX_TASKS.md` still holds.
- Founder actions: WhatsApp Cloud API app (test number, webhook to `/functions/v1/whatsapp`), `OPS_PHONES`, a real buyer/shop for the video.

Never put keys in the repo, logs or chat. Never weaken escrow/ledger checks to make something pass.

## Until Monday Nov 2 — Codex owns the build
Claude's usage resets on **Monday, Nov 2**. Until then Codex is the only engineer. Code freeze is Nov 3; submission Nov 4, 6 PM Nairobi.

**Order of work (stop and report if blocked; don't skip ahead past a broken live flow):**
1. Wed–Thu: confirm the empty-reply fix live; fix SAM (item 4 above); re-measure latency (item 5).
2. Thu: **live Loop hero flow** in the simulator: farmer lists rice husk with the one-time code on paper in the photo → business bids →
   accept (escrow) → delivered → buyer intake on `web/intake.html` with a partial quantity → seller paid, rest refunded. Fix what breaks.
   This must work before anything else on the list.
3. Fri: K3 receipt step trace (agent steps, model ids, latency shown on `trade.html` / `claim.html`), then C6 evaluation protocol.
4. Sat: C1 near-duplicate photos, then C4 cheat lab.
5. Sun: C3 ledger fingerprint; C5/C2 only if 1–4 are solid (cut-line).

**Working rules while Claude is away:**
- Small PRs on `codex/<task>`; merge to `main` yourself only when `bun test` passes **and** the live simulator still completes a tree claim
  and a Loop trade after deploy. If a deploy breaks live, revert first, then fix.
- Keep `docs/STATUS.md` updated at the end of each work session: what shipped (commit ids), live test results, what's broken, open questions for
  the founder. Claude reads this first on Monday.
- Anything needing a key, account, payment or a real person (WhatsApp app, buyer, shop, filming) → write it in `docs/STATUS.md` under
  "Founder actions" and ask the founder; never invent credentials or fake data in public views.
- Don't touch the submission copy, video script or X posts; Claude does those Monday with the founder.

**Monday handover to Claude:** `docs/STATUS.md` current, `main` green, live demo working, list of known issues.
