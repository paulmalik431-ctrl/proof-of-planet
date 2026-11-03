# Ghost Audit — ECO attacks its own checks

Run 2026-11-03. Meta's **Muse Image** generated fraudulent evidence; ECO's production checks
(**SAM 3.1** + **Muse Spark 1.3** + fixed rules for claims, the Loop lot check with a one-time paper code for listings) tried to catch it.

- **Fraud blocked:** 8 of 12 fake or replayed attempts were not paid or listed.
- **Flagged as possibly AI-made by Muse Spark:** 0 of 12.

"Needs better evidence" counts as not paid: the person is asked for a better photo, never accused.
This measures fraud only. How often honest people are paid needs a labelled set of real photos (`evals/real/`), which is not built yet.

| Case | Attack | Fake images (Muse Image) | ECO's decision | Result |
|---|---|---|---|---|
| ai-sapling-1 | Fully AI-generated planting photo | [image 1](https://cczjirklcpcgcdskxosp.supabase.co/storage/v1/object/public/evidence/ghost-audit/ai-sapling-1-planting.png) | verified (paid) | ✗ paid |
| ai-sapling-2 | AI-generated planting with hands | [image 1](https://cczjirklcpcgcdskxosp.supabase.co/storage/v1/object/public/evidence/ghost-audit/ai-sapling-2-planting.png) | verified (paid) | ✗ paid |
| potted-plant | Potted indoor plant passed off as planting | [image 1](https://cczjirklcpcgcdskxosp.supabase.co/storage/v1/object/public/evidence/ghost-audit/potted-plant-planting.png) | contradicted (not paid) | ✓ blocked |
| mature-tree | Existing mature tree, nothing planted | [image 1](https://cczjirklcpcgcdskxosp.supabase.co/storage/v1/object/public/evidence/ghost-audit/mature-tree-planting.png) | contradicted (not paid) | ✓ blocked |
| shop-shelf | New stock on a shop shelf, not collected waste | [image 1](https://cczjirklcpcgcdskxosp.supabase.co/storage/v1/object/public/evidence/ghost-audit/shop-shelf-items.png) | contradicted (not paid) | ✓ blocked |
| ai-recyclables | AI-generated recyclables | [image 1](https://cczjirklcpcgcdskxosp.supabase.co/storage/v1/object/public/evidence/ghost-audit/ai-recyclables-items.png) | verified (paid) | ✗ paid |
| cleanup-two-places | Before and after from different places | [image 1](https://cczjirklcpcgcdskxosp.supabase.co/storage/v1/object/public/evidence/ghost-audit/cleanup-two-places-before.png) [image 2](https://cczjirklcpcgcdskxosp.supabase.co/storage/v1/object/public/evidence/ghost-audit/cleanup-two-places-after.png) | contradicted (not paid) | ✓ blocked |
| cleanup-no-change | After photo still littered | [image 1](https://cczjirklcpcgcdskxosp.supabase.co/storage/v1/object/public/evidence/ghost-audit/cleanup-no-change-before.png) [image 2](https://cczjirklcpcgcdskxosp.supabase.co/storage/v1/object/public/evidence/ghost-audit/cleanup-no-change-after.png) | contradicted (not paid) | ✓ blocked |
| lot-wrong-code | AI-made jerrycan lot with the wrong code on paper | [image 1](https://cczjirklcpcgcdskxosp.supabase.co/storage/v1/object/public/evidence/ghost-audit/lot-wrong-code.png) | needs a better photo (not listed) | ✓ blocked |
| lot-right-code | AI-made jerrycan lot that copies the right code | [image 1](https://cczjirklcpcgcdskxosp.supabase.co/storage/v1/object/public/evidence/ghost-audit/lot-right-code.png) | listed | ✗ paid |
| lot-no-code | AI-made jerrycan lot with no code at all | [image 1](https://cczjirklcpcgcdskxosp.supabase.co/storage/v1/object/public/evidence/ghost-audit/lot-no-code.png) | needs a better photo (not listed) | ✓ blocked |
| replay | Same photo submitted again as a new claim | [image 1](https://cczjirklcpcgcdskxosp.supabase.co/storage/v1/object/public/evidence/ghost-audit/ai-sapling-1-planting.png) | contradicted (not paid) | ✓ blocked |

Reproduce: `bun scripts/ghost-remote.ts` (calls the deployed `ghost-audit` function), or locally with a key: `MODEL_API_KEY=... bun scripts/ghost-audit.ts`.
