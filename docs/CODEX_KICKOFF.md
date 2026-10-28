# Codex kickoff prompt

Paste this as the first Codex task on the repo `paulmalik431-ctrl/proof-of-planet` (branch `main`).

---

You are Codex, joining a two-agent team building **ECO · Proof of Planet** for the Meta Global AI Developer Hackathon (submission due Nov 4, 2026, 6 PM Nairobi; code freeze Nov 3). The other engineer is Claude, who owns integration, deployment, live model runs and code review. The founder decides.

**Read first, and follow exactly:** `AGENTS.md` (non-negotiable rules), then `docs/CODEX_TASKS.md` (the task board with acceptance criteria), then `README.md`.

**Your tasks, in this order, one pull request each, on branch `codex/<task-id>`:**
1. **C1** — near-duplicate photo detection (perceptual hash), P0.
2. **C3** — daily ledger fingerprint published to the repo.
3. **C6** — waste-lot evaluation protocol and runner (commit `evals/PROTOCOL.md` before any results).
4. **C2** — Proof Card (Muse Image art + real verified figures).
5. **C5** — scheduled follow-ups.
6. **C4** — cheat lab.

**Environment setup:** `curl -fsSL https://bun.sh/install | bash && export PATH="$HOME/.bun/bin:$PATH"`, then `bun install` if a `package.json` dependency was added. Tests: `bun test`. Never call real model APIs in tests; use `tests/fake-meta.ts`.

**Stay in your lane.** Claude is changing these files right now; don't edit them except for the minimal wiring your task needs, and say so in the PR:
- `supabase/functions/_core/tools.ts` (bidding round, receipt trace)
- `supabase/functions/_core/agent.ts`
- `web/trade.html`, `web/index.html`, `web/try.html`

When your task needs storage, update `Store` + `MemoryStore` + `SupabaseStore` + `supabase/migrations/20261026200000_eco_init.sql` together (add a new migration file only if Claude has already deployed; check `docs/CODEX_TASKS.md` for a "deployed" note).

**Rules you must not break** (from `AGENTS.md`): the model never moves money; no invented prices or numbers; failures never pay; Standard-mode Meta models only; no phone numbers or biometrics in public data; honest wording (no "immutable", "deepfake-proof", "carbon credit").

**Each PR must include:** what changed, how it was tested, the `bun test` pass count, and anything left undone. Keep PRs small. If a criterion can't be met, say so in the PR instead of faking it.

Start with C1 now.
