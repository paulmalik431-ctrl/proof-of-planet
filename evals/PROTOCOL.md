# Waste lot evaluation protocol (C6)

## Purpose and scope

Measure how ECO classifies a submitted waste-lot image as `listed`, `needs_better_photo`, or `rejected`, and how its quantity estimate compares with a human count. This is a small, frozen engineering evaluation, not a population-level estimate of field performance. Results apply only to the cases and model versions recorded in each run.

The frozen dataset is `evals/lots/labels.json`; each row names one image under `evals/lots/`, its expected SHA-256, claimed material and quantity, one-time code, human material/count label, expected outcome, rationale, and two distinct non-identifying reviewer handles who agreed. The runner checks the image hash and reviewer agreement before making any model call. The dataset version hashes every label plus image hashes, so a relabel produces a new version. Dataset files and labels are not changed between provider runs. Any correction creates a new dataset version and is documented before rerunning either provider. Do not include identifiable people, phone numbers, or other personal data.

## Case labels

- `material`: human-identified material from the fixed `MATERIALS` catalog.
- `claimed_qty`: the seller's declared quantity, in that material's catalog unit.
- `code`: the exact one-time challenge visible in the image, or an empty string when the case intentionally omits it.
- `expected`: human adjudication of the correct system disposition: `listed`, `needs_better_photo`, or `rejected`.
- `human_count`: independently counted physical items/sacks/containers when countable; use `null` when the image depicts a mass that cannot be reliably counted. It is not inferred from model output.
- `fake`: whether the case is deliberately fabricated or materially misleading. This is fixed in the labels and used for false-accept reporting.
- `notes`: concise basis for the human label; no personal data.

Two reviewers should agree on material, outcome, and count before a case is frozen. Record two non-identifying aliases such as `reviewer_alpha`, never real names or contact details, and set `review_agreement` only after both reviewers agree. Resolve disagreements and lock all image hashes and labels before the first evaluation call. A case with unresolved ground truth is excluded and recorded as such; do not silently relabel after seeing model output.

## Procedure

1. Review and freeze all case files and labels. Record the dataset version and SHA-256 for every image.
2. Run the exact same cases with `--provider=meta` and `--provider=baseten`. Meta uses Muse Spark 1.3 and SAM 3.1; Baseten uses Muse Spark Open and the same SAM 3.1 path when `MODEL_API_KEY` is configured. The runner records the actual chat model, SAM model availability, provider, timestamp, and API calls. No model is called by metric tests.
3. Do not tune prompts, rules, thresholds, or labels between the two runs. Keep raw per-case assessments and errors in `evals/lots/results.json`; errors are not counted as successful decisions.
4. Record per-case cost from provider billing or configured price data when available. The API does not return a reliable monetary cost, so unknown cost is `null`; never invent or estimate a price without a cited rate card and recorded token/image usage.

## Metrics

- **Disposition accuracy:** exact match between `assessment.outcome` and human `expected`; show the 3×3 confusion matrix.
- **Listed vs. not listed:** report precision and recall for `listed` as the positive class, with counts and denominators.
- **Identification accuracy:** fraction of cases where the model's `identified_as` equals the human material label.
- **False accept of fakes:** fabricated/misleading cases that the system lists, divided by all fake cases with a completed assessment.
- **False reject of real lots:** real cases whose human outcome is `listed` but the system does not list, divided by real cases whose human outcome is `listed`.
- **Count error:** absolute error between model `sam_count` (for `items`) or `observation.estimated_quantity` (for `kg`/`litres`) and `human_count`; report mean absolute error and the number of countable cases. Do not compare unrelated units.
- **Cost per case:** actual billable cost if known; otherwise report `unknown` and include model/API-call metadata.

Always publish numerators, denominators, errors, and the dataset version alongside rates. With a small dataset, rates are descriptive only and must not be presented as a general false-accept guarantee.

## Reproduction

After the protocol and frozen labels/images are committed, and only with explicit operator credentials:

```sh
MODEL_API_KEY=... bun scripts/eval-lots.ts --provider=meta
MODEL_API_KEY=... BASETEN_API_KEY=... bun scripts/eval-lots.ts --provider=baseten
```

Never run real model APIs in tests. Use `tests/fake-meta.ts` or isolated fake clients for metric and runner tests.
