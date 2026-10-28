# History of the build: the founder's conversation with Claude, Oct 26 – 28, 2026

What the founder asked for, in order, what was decided and why, and what was built. Read it together with `docs/CONTEXT.md`, which sets out where we are going, and `docs/HANDOFF.md`, which says what to do next. Private details and keys are deliberately left out, because this repository is public.

## Day 1–2 (Oct 26–27): from research to a product

1. **Research first.** The founder asked Claude to research previous Meta and AI hackathon winners, and to read the kickoff slides and the Discord announcements. Lessons from that research:
   - Winners pair one sharp real-world problem with a live, watchable demo.
   - Judges reward visible use of several Meta models: the Meta tooling criterion says it should have "surprised even us".
   - An earlier **AI-for-Good** win by the founder used an "Evidence File" style of presentation (exhibits, simplicity, proof). Present this project the same way.
2. **Official rules** (from the kickoff and Discord):
   - Scoring: Impact 30%, Meta tooling 25%, Technical depth 20%, Demo 25%. In the final round, judges watch the videos live.
   - The Open Weight prize needs Muse Glimmer or Muse Spark Open, verified by the infrastructure partner.
   - The Creative prize needs Muse Image or Muse Wonder *in the final experience*.
   - The Agentic prize judges autonomy, effectiveness and usefulness.
   - Most Viral counts X engagement until Nov 8. Community Vote runs Nov 9–16.
   - Deadline: Nov 4, 9 PM EST, which is Nov 5, 05:00 Nairobi. The repository must be a standalone extract of hackathon work, and the video must open by saying what existed before and what is new.
3. **"Create a new repo for this project purposely. Goal is to finish first. You are going to do this end to end. Be mindful of credits."** The repository `paulmalik431-ctrl/proof-of-planet` was created for this. An earlier experiment on the founder's existing app repo, the branch `hackathon/meta-verify` in earth-buddy-app, stays unmerged.
4. **"You've left out so many components that made us win AI for Good. I want this delivered in a day. Find better names and be creative."** This turned the project into **ECO · Proof of Planet**:
   - Five engines: **Witness** (earn), **Loop** (trade), **Glance** (spend), **Atlas** (fund), **Vault** (ledger and Reserve).
   - One WhatsApp agent runs all five.
   - Taglines:
     - "ECO makes climate action attractive, and tradeable."
     - "Bitcoin is mined with electricity. ECOIN is minted by Proof of Planet."
     - "AI assesses. Rules decide. Anyone can audit."
   - Business model: fees, not ECOIN's price.
5. **Budget questions.** The founder asked "Is that enough to finish first?" and "Will 150 credits be enough?". Claude answered honestly about scope, and the plan was cut to what can be shown live.
6. **Strategy reviews with a ChatGPT strategist chat**, five rounds, at the founder's request ("think hand in hand with GPT", "take us to 10/10", "compare with previous winners"). Outcomes:
   - **Recycling and deepfakes.** The founder asked about face scanning and fake photos. Decisions:
     - Never build face recognition. Glance uses a WhatsApp code, and face pay is roadmap only (a certified provider, 1:1 matching, no face database).
     - Fight fakes with a one-time code written on paper in the photo, duplicate-photo checks, a check for photos that look AI-made, a second human witness (the buyer's scale), and a **Ghost Audit**: attack our own checks with Muse Image fakes and publish the results.
   - **"I'm not in Nairobi."** The founder is abroad, so a local team films and lines up partners. The product is framed as global, with Kenya as the first real use.
   - **The key product idea, from the founder:** "An AI model that matches waste to value-adding companies, for example rice husk to a briquette maker." This became **Loop**, the hero of the demo:
     - A waste catalogue covering rice husk, sawdust, maize cobs, coffee pulp, used cooking oil, food waste, PET bottles, cans, cardboard and e-waste.
     - The AI identifies and grades the lot but never sets the price; the price is the winning buyer's bid.
     - The buyer's payment is held in escrow.
     - The buyer weighs the delivery and pays only for what they accept; the rest is refunded.
     - In disputes, the AI recommends and a human decides.
   - The strategist's last corrections set the order of work: evaluation protocol first, then near-duplicate photos, cheat lab, ledger fingerprint and follow-ups, with the Proof Card last. They also added escrow safety tests and the **cut-line** (see `CODEX_TASKS.md`).
7. **"Package all this and start development."** Claude then built the whole core offline, in `supabase/functions/_core`:
   - the agent with 23 tools;
   - Witness protocols and rules;
   - the SAM output parser;
   - Loop grading, matching and mediation;
   - Glance codes;
   - a double-entry, hash-chained ledger whose rules are identical in TypeScript and SQL.

   Around it:
   - the Supabase schema with public read-only views;
   - edge functions: `whatsapp`, `simulate`, `atlas` and `intake`;
   - the website, in AI-for-Good exhibit style: home, four-phone demo, Evidence File, trade, listing, ledger check, Atlas map, buyer intake;
   - tests, a dev server with a rice-husk demo story, and the Ghost Audit script.
8. **"I attached a card on the Meta API. Work hand in hand with GPT and Codex to avoid exhausting limits."** This led to `AGENTS.md`, the Claude/Codex task board (`CODEX_TASKS.md`) and the Codex kickoff prompt.
   - The Baseten path (Muse Spark Open) was added, so the agent can run on open weights.

## Day 3 (Oct 28): live

9. **"Disclose."** Meta's free-credit terms (Meta may use what is sent to its models) are now stated in the consent message, on the website and in the README.
10. **Deploy.** The founder created the Supabase project and added the GitHub and Supabase secrets; Claude handled everything that wasn't a secret. Results:
    - The database and functions are deployed through GitHub Actions.
    - GitHub Pages is on, and the site reads live data.
    - The public views are open; private tables are hidden.
11. **K0, escrow safety.** Claude found a real bug: escrow is one shared account, so a repeated or simultaneous confirmation could have paid out of another trade's money. Fix:
    - Escrow is now tracked per trade, in both `checkLegs` and `ledger_post`.
    - Each trade can be locked once and can never pay out more than it locked.
    - Verified against a real Postgres database, with nine new tests.
12. **First live runs, with Muse Spark 1.3 and SAM 3.1.**
    - The agent handled Swahili and English.
    - Witness refused a snowy photo claimed from Nairobi ("needs better evidence") and a reused photo ("contradicted"). Nothing was paid wrongly.
    - Bugs found and fixed:
      - A Meta key was deleted mid-test, which caused 401 errors; the founder replaced it.
      - The new key's replies arrive as parts, which the code now reads.
      - Muse Spark 1.3 spent its whole 600-token reply limit on reasoning; the limit is now at least 4,000.
      - When the model is silent after a tool, the agent asks once more, then describes the result itself.
    - Still open: **SAM returns empty text**, so counts are 0. See HANDOFF.
13. **"Your credits are being exhausted; can we shift to Codex?"** and **"Instruct Codex; your limit resets Monday."** Claude wrote `HANDOFF.md`, gave Codex the plan until Monday, and briefed it in the Codex app.
14. **"How do I set up WhatsApp?"** Claude gave the founder step-by-step instructions. It is the founder's task, and still pending.
15. **"It must understand where we are coming from and where we are going."** This led to `docs/CONTEXT.md`. **"Give it full context of this conversation from the beginning."** This led to this file.

## The founder's working style (how to work with him)
- He wants to win, "10/10", across all the prizes, and he wants delivery, not plans. Be decisive, and show working results.
- He is credit-conscious. Do the cheapest thing that proves the point live.
- He directs and tests. He does the steps that need his accounts (keys, sign-ins, payments, partners). Anything else, do yourself.
- He's often on mobile and away, so keep `docs/STATUS.md` short and clear. Ask one specific question when you are blocked.
- Plain language. Honest status. Never claim something works unless you've seen it work live.
