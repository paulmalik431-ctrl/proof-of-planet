# Status — Oct 28, 2026

## Shipped locally

Local branch `codex/C6` includes the prior work through `9dad15d`, plus the local commits recorded below. The branch is being prepared for publication after `git pull origin main` completed and reported already up to date. Committed work includes C6 protocol/runner/metrics/schema (`327c902`, `767fa25`, `299881c`, `c41706e`), SAM empty-SSE diagnostics/finalized text extraction (`af623c5`, `b826cad`), K3 receipt traces (`cadbcc0`), and C1 near-duplicate detection (`77c0246`). K3 claim-step timeline is in `6de8365`; C6 dataset integrity is in `5fea287`; live Loop checkpoint is recorded in `a08be80`; GitHub access failure is in `250677b`; local-photo dependency is in `8a5f18b`. Nothing from this branch is pushed.

Full root test suite after the live-rejection retry-guidance fix: 71 passed, 0 failed, 245 assertions. Targeted root Loop and escrow suite: 20 passed, 0 failed, 97 assertions. `bun run build:web` passed, and generated `web/js/ledger.js` matched the committed output. The C6 label file remains empty; its schema now requires two distinct non-identifying reviewer handles, agreement, and a frozen image SHA-256. The runner verifies each hash before any model call, and dataset versions cover all labels as well as image hashes. No model evaluation or metrics are claimed. The SAM parser regression test covers Meta's documented `response.content_part.done` event shape, not a captured production response.

## Live checks

- Tree simulator check `c02f0119-b416-4ab9-bc81-74ad89f186f4` completed with Muse Spark 1.3, SAM 3.1, `planting: 1`, 9.467 s, and a model-written reply after `verify_claim`. The zero-count issue did not reproduce in this run. Local SAM changes remain undeployed and unverified live.
- Loop simulator run created a 5,000 ECOIN demo deposit. The public ledger shows the deposit labelled `Test deposit (demo only)`. A rice-husk seller session consented and asked to sell 500 kg; the live agent returned the challenge-code/photo/location instructions. Because the founder is not near rice husk, a second live session was started for 100 used PET bottles; it received the challenge-code/photo/location instructions. Follow-up reads of `public_listings` and `public_trades` both returned HTTP 200 with empty arrays. The live session poll returned HTTP 200 and confirms the seller session exists with no pending messages. The attached genuine photo visibly shows large empty/recyclable jerrycans, while the initial simulator session declared 100 PET bottles. After the seller identified the material as empty/recyclable jerrycans and shared the Mumias pickup area, the live verifier said the photo did not match PET and canceled listing `ee754149-e4e5-4146-a012-5efc9e874bfe` (material `pet_bottles`, status `cancelled`). There is no trade; no escrow or ECOIN moved. The listing view contains this canceled row, not an active listing. Escrow, delivery, intake, payout, refund, Reserve, and trade-ledger checks remain unexercised live.
- No genuine rice-husk lot photo with the one-time code on paper was available. No listing or transaction was fabricated. The business demo balance is a test deposit, not real value.
- K3 receipt trace is shown locally on claim and trade pages: timelines plus each recorded model id, endpoint, success/failure, and latency. The claim page now also lists claim opening, evidence receipt, evidence check, and reward postings in chronological order using public records. Its extracted module passes `node --check`; this addition is not live-verified. C1 adds a 64-bit box-averaged dHash, JPEG/PNG decoders, fail-open behavior when decoding is unavailable, and 2,000-row near-duplicate checks for Witness and Loop. Tests generate a real JPEG, crop/resize/recompress it, compare an unrelated JPEG, and exercise both agent rejection paths. C1/K3 changes are not deployed or live-verified. C3 adds a daily/manual workflow to append the latest public-ledger fingerprint and a ledger-page comparison after chain verification. It is not on main and has not published a live anchor. C4 is not implemented; its Muse Image and real photo fixtures are still missing. Deno is not installed here, so the Deno-specific C1 decoder did not receive a local Deno type check.

## Broken / blocked

- The first plastic simulator draft was assessed as a material mismatch and canceled by the live verifier. The public listing row is explicitly `cancelled`; there is no active listing or trade. No escrow or payout was triggered. The rice-husk session still needs an actual lot photo from a local contact. Offline tests cover the lifecycle after listing, not a live settlement.
- C6 evaluation needs a human-reviewed, non-identifying photo set. Founder photos needed: the hero rice-husk sacks with the listing code visible; real accepted examples for sawdust, maize cobs, coffee pulp, PET bottles, cans/cardboard and other selected catalog materials; unclear/poor photos; wrong-material lots; misleading/fake cases; and countable items plus uncountable mass lots. Every label requires material, claimed quantity/unit, exact code or intentional missing code, expected outcome, human count or null, fake flag, rationale, a frozen image SHA-256, and two distinct non-identifying reviewer handles with recorded agreement. Do not invent labels.
- GitHub CLI authentication is valid, but the bundled Git Credential Manager launch path still prevents normal `git push`. The UI-only homepage has merged and deployed through PRs #1 and #2. C6 backend/evaluation changes remain pending publication and review. No deployment or live test of local SAM, K3, or C1 changes has occurred. The ledger anchor workflow has not run.

## Founder actions

- The jerrycans were identified as empty/recyclable jerrycans and the seller area as Mumias, but this verifier session was declared as PET bottles and was safely canceled. If the product catalog does not support jerrycans, choose a supported material only when it accurately describes a real lot. For the rice-husk hero trade, arrange a genuine photo from a local contact.
- Arrange a genuine photo of a supported recyclable lot with the fresh challenge code visible so the live Loop trade, escrow, intake, payout, and refund can be demonstrated. Complete the C6 PR review and deployment checks.
- Decide whether to run an isolated live Muse Spark Open trial for the Open Weight prize. No Baseten key is configured locally; Muse Spark 1.3 remains the main agent until the alternate passes a real comparison.
- Decide on the proposed C7 testnet mirror only after the live Loop trade works. The internal ledger stays authoritative; the model must never hold signing keys.
- Supply the C6 photo set and independently reviewed labels described above. Keep people, phone numbers, and other personal data out of images and labels.
- For C4, supply one genuine, non-identifying planting/action photo and one genuine waste-lot photo; then choose/approve Muse Image generated attack fixtures using authorized test credits. No live model generation has been run locally.





## Latest session update

- Local code now tells the seller that a rejected photo cancels the draft and they must restart sell_waste to receive a fresh challenge code. A regression test covers cancellation, clearing the open draft, and no trade creation. Full root suite: 71 passed, 0 failed, 245 assertions. bun run build:web and ledger artifact check still pending for this session.
- Live test outcome: mismatch was rejected and canceled; no trade or money movement. The prompt to retry should use a new challenge. Genuine rice-husk proof photo remains pending from a local contact.
- Founder action: re-authenticate GitHub CLI and provide a supported material/correct seller flow for an actual jerrycan lot if that catalog path exists. No credentials in chat.


## Latest session update — Oct 28

- Redesigned the home page with an editorial field-guide direction, custom Verify → Trade → Spend diagram, clearer responsive hierarchy, and accurate buyer-bid language. Commit: 8b21eb6.
- Verification: root Bun suite 71 passed, 0 failed, 245 assertions; bun run build:web passed and generated ledger bundle matches committed output.
- Deployment: not live. git push -u origin codex/C6 failed because GitHub CLI credentials are invalid and no username prompt can be opened in this environment. GitHub Pages deploys only from main; repo policy also requires live tree and Loop simulator checks after deploy. There is no PR or merge, and those live checks have not passed.
- Founder action: re-authenticate GitHub CLI with gh auth login -h github.com, then ask Codex to push and open the PR. Do not share tokens in chat.


## UI publication checkpoint — Oct 28

- Founder feedback said the first UI revision remained unappealing. A stronger second pass was merged in PR #2: dark forest hero, citrus accent, product flow board, varied section surfaces, and tighter trust cards. Local branch commit: `d765624`.
- UI-only PR [#2](https://github.com/paulmalik431-ctrl/proof-of-planet/pull/2) merged to `main`; CI passed (56 tests, 190 assertions), and the Pages deployment succeeded. The live homepage was opened and its updated hero and process flow were verified.
- The current real jerrycan photo was safely rejected because jerrycans are not a supported catalog material. No live trade, escrow, or settlement exists yet. A genuine photo of a supported recyclable lot is needed to resume the live test.
- The `codex/C6` backend/evaluation work remains unpublished pending a separate PR. Normal `git push` still fails in the bundled Git Credential Manager; use the authenticated GitHub API path for the branch/PR if needed.
## Latest session update — Oct 29
- Merged PR #3 (`a7b3755`) to `main`, bringing C6 lot-evaluation protocol/schema/runner, SAM parsing diagnostics, K3 receipt traces, C1 near-duplicate checks, ledger anchor support, and the cleanup removing unused `package-lock.json`.
- Verification: GitHub Actions PR test passed after adding `bun install` to CI. Post-merge CI passed; Supabase backend deployment run #7 succeeded. The prior live tree simulator result remains documented above; a new post-deploy tree simulator run has not been confirmed this session.
- Live Loop result is unchanged: the real photo showed empty/recyclable jerrycans, which the PET listing verifier rejected and canceled. No active trade or escrow exists; delivery, partial intake, payout, refund, Reserve and trade-ledger settlement remain unverified.
- C6 labels remain empty pending the founder’s genuine photo set and independent human review.
- Founder actions: arrange a genuine photo of a supported recyclable lot with the fresh challenge code visible to complete the Loop settlement path; supply the C6 photo set and reviewed labels.

## Latest update — Oct 29, 2026

- UI: a second home-page redesign is ready locally. It uses a custom system diagram built in SVG, technical typography, restrained colors, explicit trust boundaries and source-linked metrics. It uses no generated imagery. The WhatsApp CTA appears only after `WHATSAPP_NUMBER` is configured in `web/config.js`. It has not been deployed or visually verified in the live site.
- WhatsApp: the Cloud API webhook, inbound text/photo/location parsing, signed-request check, agent routing and outbound replies already exist. The integration is currently unconfigured: the live project has no WhatsApp credentials and `web/config.js` has no phone number.
- Security finding: the deployed webhook accepted the GET verification challenge while `WHATSAPP_VERIFY_TOKEN` was empty. Local code now rejects empty or mismatched verification tokens, rejects signatures when the app secret is missing, returns `503` for inbound messages until required secrets are present, and refuses outbound sends without configuration. Tests cover these fail-closed cases. This fix is not deployed; do not connect Meta until the fix ships.
- Verification: `bun test tests/` passed 128 tests, 0 failed, 441 assertions in this checkout; the command also discovered duplicate tests under the nested `work/proof-of-planet/tests/` directory. Clean GitHub CI only has the root `tests/`. `bun run build:web` passed; `web/js/ledger.js` was unchanged; `git diff --check` passed.
- Publish status: the local `codex/C6` branch was behind current `main`; latest `main` was pulled. The changes are now on a fresh local `codex/ui-whatsapp` branch, but have not been pushed or opened as a PR yet.
- Live status: the webhook needs the fail-closed deployment and a new GET probe to confirm an empty token returns 403. The live Loop trade is still incomplete: the actual photo showed jerrycans, which did not match the declared PET material; the verifier canceled the draft and no trade or money moved.
- Founder actions to make WhatsApp live: create or select the Meta developer app and WhatsApp Cloud API test number; add the founder's test recipient in Meta; set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` and `OPS_PHONES` only in Supabase Edge Function Secrets; configure the Meta callback as `https://cczjirklcpcgcdskxosp.supabase.co/functions/v1/whatsapp`, using the same verify token, and subscribe to `messages`; then set the public test number in `web/config.js`. Never put these secrets in source code, logs, or chat. A temporary token can expire, so confirm it remains active before the live demo.
