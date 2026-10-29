# Ghost Audit — ECO attacks its own checks

Not run yet. Once run, this page lists every fake and real case and whether ECO paid it.

`MODEL_API_KEY=... bun scripts/ghost-audit.ts` generates fraudulent evidence with Muse Image, mixes in labelled
real photos from `evals/real/`, runs each case through the production verifier (SAM 3.1 + Muse Spark + rules)
and writes the results here.

## Waste lot evaluation (C6)

Not run. `evals/lots/labels.json` is empty because this checkout does not contain waste-lot photos with human-confirmed material/count labels. Add and review non-identifying photos, freeze labels and hashes, then use `bun scripts/eval-lots.ts --provider=meta` or `--provider=baseten`. The runner refuses to call models on an empty dataset.
