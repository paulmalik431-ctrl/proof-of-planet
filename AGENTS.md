# Working on ECO · Proof of Planet

Two AI engineers share this repo: **Claude** (integration, deployment, live model runs, review) and **Codex** (self-contained tasks from `docs/CODEX_TASKS.md`). The founder decides; nobody merges to `main` without passing tests.

## Rules that never bend
- **The model never moves money.** ECOIN moves only through `store.post()` legs that pass `checkLegs()` (mint after verification, escrow from the buyer's own balance, release on the buyer's weighed intake or a human reviewer's decision, shop payment with the customer's code). Never add a tool or endpoint that lets a model choose an amount.
- **Escrow is checked per trade.** Every post touching `eco_escrow` needs the trade id as `ref`; a trade locks once and can never pay out more than it locked (`checkLegs` and `ledger_post` both enforce it; see `tests/escrow.test.ts`).
- **No invented prices or numbers.** Prices come from buyers' bids; quantities paid come from the buyer's weighed intake. Model outputs are observations, never authorities.
- **Fail safe.** A model error, malformed output or missing evidence must never pay; it holds, asks or routes to review.
- **Meta Model API in Standard mode only** (`-contributor` models are refused in `_core/meta.ts`). Every model call goes through `MetaClient`.
- **Privacy.** Never publish phone numbers; public data goes through `public_*` views only. No face recognition, no biometric storage.
- **Honest wording.** Never write "immutable", "deepfake-proof", "carbon credit", or claim a pilot that didn't happen.
- **Only hackathon work in this repo** (built from Oct 26, 2026). Don't copy code from the pre-existing ECO app.

## Layout
- `supabase/functions/_core/` — runtime-agnostic TypeScript (Deno in production, Bun in tests, browser for `ledger.ts`). No `Deno.*` or `process.*` here.
  - `agent.ts` (WhatsApp agent loop), `tools.ts` (the agent's tools and the rules behind them), `loop.ts` (waste-to-value), `verify.ts` + `rules.ts` + `protocols.ts` (Witness), `glance.ts` (payments), `ledger.ts` + `money.ts` (Vault), `meta.ts` (model client), `store.ts` (Store interface + MemoryStore), `whatsapp.ts`.
- `supabase/functions/<name>/index.ts` — Deno edge functions (`whatsapp`, `simulate`, `atlas`, `intake`). `_shared/` holds the Supabase store and env wiring.
- `supabase/migrations/` — the schema. Keep SQL rules identical to TypeScript rules (see `ledger_post` vs `checkLegs`).
- `web/` — static site (GitHub Pages). Plain ES modules, no build step except `web/js/ledger.js` (`bun run build:web`).
- `tests/` — Bun tests, offline. `tests/fake-meta.ts` scripts model answers; use it, never call real APIs in tests.

## Commands
```bash
curl -fsSL https://bun.sh/install | bash   # if bun is missing (setup step)
bun test                                    # must pass before any PR
bun run build:web && git diff --exit-code web/js/ledger.js
```
Deno type-check (if Deno is available): `deno check --node-modules-dir=none supabase/functions/*/index.ts`.

## How to deliver a task
1. Branch `codex/<task-id>` (Codex) or `claude/<task-id>` (Claude).
2. Implement exactly the task's acceptance criteria; add tests for every rule.
3. Update `MemoryStore` **and** `SupabaseStore` **and** the migration when you add storage.
4. PR title `[<task-id>] <summary>`; body lists what changed, how it was tested, and anything left undone. End with the tests' pass count.
5. Small, reviewable PRs. Don't reformat unrelated code.
