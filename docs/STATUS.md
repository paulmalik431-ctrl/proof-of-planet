# Status — Oct 29, 2026

## Shipped
- PR #3 (`a7b3755`): C6 evaluation protocol/runner, C1 near-duplicate detection, K3 traces, C3 ledger anchoring, and related tests.
- PR #5 (`85e54ab`): redesigned homepage and fail-closed WhatsApp webhook. CI, Pages, and Supabase deployment succeeded.
- PR #7 (`133e4e0`): separate item-counted `plastic_jerrycans` Loop material. PR #8 (`94a5d15`): welcome copy mentions jerrycan reuse/recycling. Their CI and backend deployments succeeded.
- PRs #9–#11 updated the current project status. The local checkout tracks `main` and has no uncommitted product-code changes.

## Live checks
- Homepage is live with the custom SVG system diagram and was inspected at desktop and 390px mobile widths. No generated imagery is used.
- WhatsApp webhook now rejects an empty verification token (GET returns 403). An unconfigured POST returns 503. These checks confirm fail-closed behavior; they do not prove a WhatsApp conversation works.
- Meta for Developers sign-in URL is available, but no Meta page is currently open in the browser. The founder must sign in and complete app setup; no profile or app has been selected.
- Seller simulator session `JrLoopOct29A1` accepted the description of empty plastic jerrycans and asked for the actual item count. Poll confirms the session exists with no new message. No quantity was guessed, no listing draft was created, and no ECOIN moved.
- Buyer simulator session `LoopBuyerOct29B1` registered as “Simulator Recycler”; `top_up_test_ecoin` issued the fixed 5,000 demo-only ECOIN deposit. A wallet read confirmed the balance and “test deposit (demo only)” entry. No bid was submitted because there is no seller listing or buyer-set price yet.
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
