# Where we come from, and where we are going

Read this before any task. It explains *why* the code looks the way it does, so your choices serve the goal and not just the ticket.

## Who and what
- **Founder:** Miskel Guya, solo founder of **ECO** (a live climate-action app, the "ECO App"). He directs; AI engineers build. He is currently abroad, not in Kenya; a local team can film and line up partners.
- **This repo:** a fresh, standalone hackathon build, **ECO · Proof of Planet**, written from Oct 26, 2026. None of the pre-existing ECO App code is in it. The video must open by saying what existed before (ECO and the ECO App) and what was built during the event (everything here).
- **Engineers:** Claude (integration, deploy, live model runs, review, submission copy) and Codex (self-contained tasks). Claude is offline until Monday, Nov 2. A ChatGPT strategist chat reviewed the plan in five rounds; its corrections are already in `docs/CODEX_TASKS.md`.

## The hackathon
- **Meta Global AI Developer Hackathon**, Startup track, theme *Build for Your World*. Oct 26 – Nov 4, 2026.
- **Deadline:** Nov 4, 9 PM EST = Nov 5, 05:00 Nairobi. **Our target: submit Nov 4, 6 PM Nairobi. Code freeze Nov 3.**
- **Judging:** Impact 30% · Use of Meta tooling 25% ("surprised even us") · Technical depth 20% · Demo 25% ("genuinely cool to watch"). In the final round judges **watch the videos live**.
- **Prizes we are going for, and what each needs:**
  - **Overall / track** → the rubric above.
  - **Open Weight** → Muse Spark Open (or Glimmer) visibly doing real work, verifiable by the infra partner (Baseten). Our path: `CHAT_PROVIDER=baseten` runs the agent on `meta-models/muse-spark-open-1026`. **Not yet proven live.**
  - **Best Creative** → Muse Image or Muse Wonder **in the final experience**. Our path: the Proof Card (C2) and the Ghost Audit / cheat lab. The Proof Card is the only Muse Image users see, so don't drop it silently.
  - **Agentic** → autonomy, effectiveness, usefulness: the WhatsApp agent working through 23 tools, the bidding round (K2), scheduled follow-ups (C5).
  - **Most Viral** → X engagement until Nov 8 EOD (Claude + founder, after submission).
  - **Community Vote** → Nov 9–16.
- Uses Meta's free developer credits: Meta may use what's sent to its models. This is disclosed in the consent message, site and README. Keep it.

## The idea (the story judges should remember)
**"ECO makes climate action attractive, and tradeable."** Bitcoin is mined with electricity; **ECOIN is minted by Proof of Planet** — earned only for verified climate action. **"AI assesses. Rules decide. Anyone can audit."**

The problems: climate action is **unverified** (funders can't trust evidence), the people doing it are **unpaid and often unbanked** (1.4B adults, World Bank Findex 2021), payments are **costly and hard**, and climate waste has **no simple market**.

Five engines, one WhatsApp agent (Muse Spark 1.3 with tool calling, any language):
- **Witness (Earn)** — plant a tree, clean up, recycle; send photos + location. SAM 3.1 counts, Muse Spark answers fixed questions, fixed rules decide: *verified / needs better evidence / contradicted*. No proof, no token. Tree survival after 30 days pays more.
- **Loop (Trade)** — **the hero flow.** Waste-to-value matching: e.g. a farmer's **rice husk → a briquette maker**, coffee pulp → composter, bottles → recycler. The seller writes a one-time code on paper in the photo (anti-replay). Meta AI identifies and grades the lot; **it never sets a price** — the price is the winning buyer's bid. The buyer's ECOIN is locked in **escrow**; on delivery the buyer **weighs and records the accepted quantity** (second witness, `intake.html`) and is paid out only for that; the rest is refunded. Disputes: AI recommends, a human reviewer decides.
- **Glance (Spend)** — pay in a shop with a 6-digit WhatsApp code (hashed, 5 min, 3 tries). Face pay is roadmap only (certified provider, 1:1, no face database). Never build face recognition.
- **Atlas (Fund)** — a live map + Muse Spark brief for funders from public numbers only.
- **Vault** — escrow + an audited **Reserve** (30% of every fee) on a public, append-only, hash-chained ledger anyone can verify in the browser.

Business model: fees, not token price — 2% marketplace + 1% escrow on Loop, 1% on Glance payments, verification fees, app revenue.

## Decisions already made (don't relitigate without the founder)
- The model can look, talk and choose tools; **only rules move money** (`checkLegs` in TS and `ledger_post` in SQL, identical). Escrow is enforced **per trade** (K0).
- **No invented numbers**: prices from bids, paid quantities from the buyer's scale, rewards from the protocol.
- Failures hold or ask; they never pay. Unclear evidence → "needs better evidence", never an accusation.
- Privacy: pseudonyms (`eco_…`), no phone numbers in public views, pickup points rounded.
- Honest wording: never "immutable", "deepfake-proof", "carbon credit", or a pilot that didn't happen. ECOIN here is a test ledger.
- Cut-line: no Proof Card / follow-ups / bidding expansion until a **real-model** claim survives intake, partial settlement and duplicate replay **live**. After that, C2 (Proof Card) matters for the Creative prize — schedule it, don't drop it.

## Where we are (Oct 28)
Live: Supabase backend, website, Meta + Baseten keys. 56 tests. The agent works live in Swahili and English; Witness correctly refused a snowy "Nairobi" photo and a reused photo. Open: SAM returns 0 (parser), Loop never run live, Spark Open never run live, verification latency 20–35 s, WhatsApp not connected. Details and how to test: `docs/HANDOFF.md`.

## Where we are going (what "done" looks like on Nov 3)
1. **A 3-minute demo that is genuinely cool to watch:** a farmer on WhatsApp lists rice husk (code on paper) → Meta AI identifies and grades it, SAM draws boxes → a briquette maker's bid wins → escrow → delivery → the buyer weighs 450 of 500 kg on `intake.html` → farmer paid, rest refunded, fees feed the Reserve → farmer spends ECOIN at a shop with a Glance code → every step is visible on the public ledger and the receipt shows which Meta model did what (K3). Plus one cheat attempt failing (cheat lab).
2. **Every Meta model visibly earning its place:** Muse Spark 1.3 (agent, grading, disputes, Atlas), SAM 3.1 (counts + boxes on Evidence Files), Muse Spark Open (same agent, open weights), Muse Image (Proof Card + Ghost Audit fakes), WhatsApp Cloud API.
3. **Evidence over claims:** the evaluation (C6) with false-accept/false-reject numbers, the Ghost Audit results, the ledger chain check and fingerprint (C3).
4. **Real people if at all possible:** a real briquette maker/recycler and a real shop in Kenya, filmed by the local team. Never fake them.
5. Submission text, video, X post and the deck: Claude + founder on Monday Nov 2.

When a choice is unclear, pick what makes the live demo more trustworthy and more watchable, write the question in `docs/STATUS.md`, and keep going.
