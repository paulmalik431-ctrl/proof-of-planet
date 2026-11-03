# Status — Nov 3, 2026, code freeze

- **Live smoke test** (`bun scripts/smoke.ts`, workflow "Live smoke test"): 27/27 passed on `9e03bb7`.
  Site pages all 200; public views readable; ledger chain intact (4 entries); Atlas brief written by `meta-models/muse-spark-open-1026`;
  WhatsApp webhook rejects a bad verify token (403) and unsigned posts (401); WhatsApp account subscribed, test number CONNECTED, quality GREEN,
  permanent system-user token works; Proof Card refuses unknown trades; seller flow (consent → welcome → "sell 100 plastic bottles" → one-time code) works.
  The cow-dung photo scout was skipped in CI only because Wikimedia rate-limits GitHub's runners (429); it was verified live on Nov 2.
- **WhatsApp connected** on Meta's test number with a permanent system-user token; real messages in and out verified Nov 2. Up to 5 allowlisted phones.
- **Fixed:** a duplicated `photoNearDuplicate` in `SupabaseStore` (Deno type error, harmless at runtime). CI now type-checks every edge function with Deno.
- **Tests:** 81 pass offline.
- **Not done:** no Loop trade has completed live yet (0 trades). The demo trade is filmed Nov 3 between two team members and must be labelled as a demo.
  No accuracy numbers: the Ghost Audit and the C6 evaluation have not been run.

# Status — Nov 2, 2026

- **Live:** agentic photo scout (`_core/scout.ts`). A photo with no context is identified by Muse Spark; rules route it. Verified live:
  cow dung photo → "manure / compost / biogas for farmers, compost makers, biogas plants — how many kg?"; street litter → cleanup claim opened
  automatically with the before photo. Never lists, prices or pays.
- New Loop material `cow_dung`. Demo page: 3-step guide + openly licensed sample photos (cow dung, cans, litter).
- UI: removed stale overlapping styles and half-applied dark mode (unreadable text); brighter muted text, min font sizes; versioned CSS links.
- Tests: 79 pass (`bun test tests/`).
- Still open: real end-to-end trade (bid → escrow → weighed intake → payout), WhatsApp connection, Muse Spark Open as main agent, video/submission.

# Status — Oct 29, 2026

## Shipped
- PR #3 (`a7b3755`): C6 evaluation protocol/runner, C1 near-duplicate detection, K3 traces, C3 ledger anchoring, and related tests.
- PR #5 (`85e54ab`): redesigned homepage and fail-closed WhatsApp webhook. CI, Pages, and Supabase deployment succeeded.
- PR #7 (`133e4e0`): separate item-counted `plastic_jerrycans` Loop material. PR #8 (`94a5d15`): welcome copy mentions jerrycan reuse/recycling. Their CI and backend deployments succeeded.
- PRs #9–#11 updated the current project status. The local checkout tracks `main` and has no uncommitted product-code changes.

## Live checks
- Homepage is live with the custom SVG system diagram and was inspected at desktop and 390px mobile widths. No generated imagery is used.
- WhatsApp webhook now rejects an empty verification token (GET returns 403). An unconfigured POST returns 503. These checks confirm fail-closed behavior; they do not prove a WhatsApp conversation works.
- Seller simulator session `JrLoopOct29A1` accepted the description of empty plastic jerrycans and asked for the actual item count. Poll confirms the session exists with no new message. No quantity was guessed, no listing draft was created, and no ECOIN moved.
- A new post-PR #8 live simulator consent check returned the updated welcome text mentioning jerrycan reuse/recycling; no model call or ECOIN movement was needed.
- The earlier PET draft was canceled for a material mismatch; its one-time photo code expired. No live trade, buyer bid, escrow, delivery, intake, payout, refund, or settlement has been completed.
- Prior live tree simulator run `c02f0119-b416-4ab9-bc81-74ad89f186f4` reported `planting: 1` and a model-written reply after `verify_claim`. Treat this as a historical successful run, not proof of a new post-deploy tree run.

## Verification
- Local full `bun test tests/`: 129 passed, 0 failed, 445 assertions. This workspace includes the nested duplicate `work/proof-of-planet/tests/`; clean GitHub CI passed on PR #8, PR #9, and PR #10.
- `bun run build:web`, generated ledger bundle comparison, and `git diff --check` passed during PR #5/#7 work. PR #8 CI repeated the build check.
- No C6 model evaluation is claimed. `evals/lots/labels.json` is still empty.

## Broken / blocked
- WhatsApp is not connected: Meta Developers is logged out; no WhatsApp app/test number is selected; Supabase lacks the WhatsApp secrets; `WHATSAPP_NUMBER` is blank. No real WhatsApp inbound/outbound message has been tested.
- Loop settlement needs the seller’s actual count, then a fresh genuine lot photo with the new one-time code, plus a real buyer’s bid. The prior photo cannot be reused because its code expired.
- C4 needs genuine non-identifying lot/action photos and approved Muse Image attack fixtures. C6 needs a genuine image set and two independent human reviewers per label. C5/C2 remain behind the agreed cut-line until a real-model trade passes intake, partial settlement, and duplicate replay.

## Founder actions
- Sign in at [Meta Developers](https://developers.facebook.com/), create/select the app, add WhatsApp Cloud API, configure a test number and recipient, and subscribe the webhook to `messages`.
- Set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, and `OPS_PHONES` only in Supabase Edge Function Secrets. Callback: `https://cczjirklcpcgcdskxosp.supabase.co/functions/v1/whatsapp`. Then publish the test number in `web/config.js`. Never send secrets in chat or commit them.
- Confirm the actual jerrycan count with the seller. After the seller flow returns a fresh code, get a new unedited photo with that code visible; arrange a real buyer to bid.
- Supply the non-identifying C6 photo set and reviewer labels, and the C4 fixtures described above.