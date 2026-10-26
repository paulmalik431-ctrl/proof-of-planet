// The ECO WhatsApp agent. Muse Spark 1.3 talks with the person in their language and drives
// the claim with tools; deterministic code files the photos and locations; verification and
// payment happen only inside verify_claim, through Meta's models and fixed rules.
// The model can talk, look and ask — it cannot move money.
import { type ChatMessage, type MetaClient, type ToolDef } from "./meta.ts";
import { nextMissingPhoto, PROTOCOLS, type ProtocolId, STARTABLE } from "./protocols.ts";
import { sha256Hex } from "./ledger.ts";
import type { Account, Claim, Session, Store } from "./store.ts";
import { verifyClaim } from "./verify.ts";

export interface Inbound {
  id: string;
  from: string; // phone number (E.164 without +) or simulator id
  at: Date;
  kind: "text" | "image" | "location" | "audio" | "other";
  text?: string;
  image?: { bytes: Uint8Array; mime: string; caption?: string };
  location?: { lat: number; lng: number };
  audio?: { bytes: Uint8Array; mime: string };
}

export interface AgentDeps {
  store: Store;
  meta: MetaClient;
  publicUrl: string; // where the Evidence File pages live
  limits: { messagesPerDay: number; verificationsPerDay: number };
  transcribe?: (audio: { bytes: Uint8Array; mime: string }) => Promise<string | null>;
  log?: (event: string, data?: unknown) => void;
}

export const CONSENT_TEXT = [
  "🌍 *ECO pays for verified climate action.*",
  "",
  "Plant a tree, clean up a place or recycle, send photos here, and Meta AI checks them. Verified work earns ECOIN.",
  "",
  "Your photos and the place you share become a public *Evidence File* so anyone can check the work. Your phone number is never shown.",
  "",
  "Reply *YES* to agree. You can write in any language.",
].join("\n");

const YES = /^\s*(yes|y|ok|okay|ndio|sawa|oui|s[ií]|ja|sim|haan|ha|evet|да|نعم|是|好|はい|네)\b/i;
const HISTORY = 16;

export async function handle(deps: AgentDeps, msg: Inbound): Promise<string[]> {
  const { store } = deps;
  if (await store.seen(msg.id)) return [];
  const account = (await store.accountByPhone(msg.from)) ?? (await store.createAccount(msg.from));

  if (!account.consent_at) {
    if (msg.kind === "text" && YES.test(msg.text ?? "")) {
      await store.setConsent(account.id, msg.at.toISOString());
      return [welcome(deps)];
    }
    return [CONSENT_TEXT];
  }

  const day = msg.at.toISOString().slice(0, 10);
  const session: Session = (await store.session(account.id)) ?? { account_id: account.id, history: [], open_claim_id: null, day, messages_today: 0, verifications_today: 0 };
  if (session.day !== day) Object.assign(session, { day, messages_today: 0, verifications_today: 0 });
  session.messages_today++;
  if (session.messages_today > deps.limits.messagesPerDay) {
    await store.saveSession(session);
    return session.messages_today === deps.limits.messagesPerDay + 1 ? ["You've reached today's message limit. Come back tomorrow 🌱"] : [];
  }

  const userText = await fileInbound(deps, account, session, msg);
  const reply = await converse(deps, account, session, userText);
  session.history = [...session.history, { role: "user" as const, content: userText }, { role: "assistant" as const, content: reply }].slice(-HISTORY);
  await store.saveSession(session);
  return [reply];
}

function welcome(deps: AgentDeps): string {
  return [
    "Welcome to ECO 🌱 What did you do for the climate today?",
    "",
    ...STARTABLE.map((id) => `• *${PROTOCOLS[id].title}*: ${PROTOCOLS[id].summary}`),
    "",
    `Just tell me, or send a photo. Your wallet: reply *wallet*. How checks work: ${deps.publicUrl}`,
  ].join("\n");
}

/** Files photos and locations deterministically and describes what happened for the model. */
async function fileInbound(deps: AgentDeps, account: Account, session: Session, msg: Inbound): Promise<string> {
  const { store } = deps;
  const open = session.open_claim_id ? await store.claim(session.open_claim_id) : null;
  const active = open && (open.status === "collecting" || open.status === "unresolved") ? open : null;

  if (msg.kind === "text") return msg.text ?? "";

  if (msg.kind === "image" && msg.image) {
    const sha = await sha256Hex(msg.image.bytes);
    const path = await store.savePhoto(msg.image.bytes, msg.image.mime);
    const caption = msg.image.caption ? ` Caption: "${msg.image.caption}".` : "";
    if (active) {
      const p = PROTOCOLS[active.protocol];
      const have = (await store.evidenceOf(active.id)).filter((e) => e.kind === "photo").map((e) => e.role!);
      let role = nextMissingPhoto(p, have)?.role ?? null;
      if (!role && p.photos.length === 1) {
        role = p.photos[0].role;
        await store.supersede(active.id, role);
      }
      if (role) {
        await store.addEvidence({ claim_id: active.id, account_id: account.id, kind: "photo", role, path, sha256: sha, lat: null, lng: null, text: null });
        if (active.status === "unresolved") await store.updateClaim(active.id, { status: "collecting" });
        return `[sent a photo — filed as "${role}" for the ${p.title} claim]${caption}`;
      }
    }
    await store.addEvidence({ claim_id: null, account_id: account.id, kind: "photo", role: null, path, sha256: sha, lat: null, lng: null, text: null });
    return active
      ? `[sent a photo — kept aside: all photos for this claim are already in; call redo_photo if it replaces one]${caption}`
      : `[sent a photo — kept aside until we know which action it shows]${caption}`;
  }

  if (msg.kind === "location" && msg.location) {
    const { lat, lng } = msg.location;
    if (active) {
      await store.updateClaim(active.id, { lat, lng });
      await store.addEvidence({ claim_id: active.id, account_id: account.id, kind: "location", role: null, path: null, sha256: null, lat, lng, text: null });
      if (active.status === "unresolved") await store.updateClaim(active.id, { status: "collecting" });
      return `[shared a location — filed for the ${PROTOCOLS[active.protocol].title} claim]`;
    }
    await store.addEvidence({ claim_id: null, account_id: account.id, kind: "location", role: null, path: null, sha256: null, lat, lng, text: null });
    return "[shared a location — kept aside until we know which action it is for]";
  }

  if (msg.kind === "audio" && msg.audio) {
    const t = deps.transcribe ? await deps.transcribe(msg.audio).catch(() => null) : null;
    return t ? `[voice note, transcribed by Muse] ${t}` : "[sent a voice note that could not be transcribed — ask them to type instead]";
  }
  return "[sent a message type ECO can't read — ask for text, a photo or a location]";
}

// ───────── state the model sees ─────────

async function status(deps: AgentDeps, account: Account, session: Session) {
  const { store } = deps;
  const open = session.open_claim_id ? await store.claim(session.open_claim_id) : null;
  let openInfo = null;
  if (open && open.status !== "cancelled") {
    const p = PROTOCOLS[open.protocol];
    const have = (await store.evidenceOf(open.id)).filter((e) => e.kind === "photo").map((e) => e.role!);
    const next = nextMissingPhoto(p, have);
    const hasLoc = open.lat !== null;
    openInfo = {
      claim_id: open.id, action: p.title, status: open.status, photos_received: have,
      next_photo_needed: next ? { role: next.role, ask: next.ask } : null,
      location_received: hasLoc,
      ready_to_verify: (open.status === "collecting" || open.status === "unresolved") && !next && hasLoc && have.length > 0,
      reward_if_verified: open.status === "consistent" ? open.reward : undefined,
      evidence_file: `${deps.publicUrl}/claim.html?id=${open.id}`,
    };
  }
  const pending = await store.pendingEvidence(account.id);
  return {
    open_claim: openInfo,
    kept_aside: { photos: pending.filter((e) => e.kind === "photo").length, location: pending.some((e) => e.kind === "location") },
    trees_due_for_survival_check: await survivalDue(store, account.id, new Date()),
    verifications_left_today: Math.max(0, deps.limits.verificationsPerDay - session.verifications_today),
  };
}

async function survivalDue(store: Store, accountId: string, now: Date) {
  const claims = await store.claimsOf(accountId);
  const checked = new Set(claims.filter((c) => c.protocol === "tree_survival" && c.status === "consistent").map((c) => c.parent_id));
  return claims
    .filter((c) => c.protocol === "tree_planting" && c.status === "consistent" && !checked.has(c.id))
    .map((c) => {
      const due = new Date(Date.parse(c.created_at) + PROTOCOLS.tree_survival.parent!.minDays * 86_400_000);
      return { planting_claim_id: c.id, planted_on: c.created_at.slice(0, 10), due_on: due.toISOString().slice(0, 10), due_now: due <= now };
    });
}

// ───────── tools ─────────

const TOOLS: ToolDef[] = [
  { type: "function", function: { name: "start_action", description: "Start a new climate-action claim. Any kept-aside photos and location are attached automatically.", parameters: { type: "object", properties: { action: { type: "string", enum: STARTABLE } }, required: ["action"] } } },
  { type: "function", function: { name: "start_survival_check", description: "Start the 30-day survival check for the person's oldest tree that is due.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "redo_photo", description: "Mark one photo of the open claim to be replaced; the next photo (or a kept-aside one) takes its place.", parameters: { type: "object", properties: { role: { type: "string" } }, required: ["role"] } } },
  { type: "function", function: { name: "verify_claim", description: "Run Meta AI verification on the open claim when ready_to_verify is true. Pays automatically if the evidence is consistent.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "wallet", description: "The person's ECOIN balance, recent ledger entries and wallet link.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "cancel_action", description: "Cancel the open claim (only if the person asks).", parameters: { type: "object", properties: {} } } },
];

async function runTool(deps: AgentDeps, account: Account, session: Session, name: string, args: Record<string, unknown>, now: Date): Promise<unknown> {
  const { store } = deps;
  const open = session.open_claim_id ? await store.claim(session.open_claim_id) : null;
  const active = open && ["collecting", "unresolved"].includes(open.status) ? open : null;

  switch (name) {
    case "start_action": {
      const action = String(args.action) as ProtocolId;
      if (!STARTABLE.includes(action)) return { error: `Unknown action. Choose one of: ${STARTABLE.join(", ")}` };
      if (active) await store.updateClaim(active.id, { status: "cancelled" });
      const claim = await store.createClaim({ account_id: account.id, protocol: action, parent_id: null });
      session.open_claim_id = claim.id;
      await attachPending(store, account.id, claim);
      return status(deps, account, session);
    }
    case "start_survival_check": {
      const due = (await survivalDue(store, account.id, now)).filter((d) => d.due_now);
      if (!due.length) return { error: "No tree is due for its survival check yet.", trees: await survivalDue(store, account.id, now) };
      if (active) await store.updateClaim(active.id, { status: "cancelled" });
      const claim = await store.createClaim({ account_id: account.id, protocol: "tree_survival", parent_id: due[0].planting_claim_id });
      session.open_claim_id = claim.id;
      await attachPending(store, account.id, claim);
      return status(deps, account, session);
    }
    case "redo_photo": {
      if (!active) return { error: "No open claim." };
      const role = String(args.role);
      if (!PROTOCOLS[active.protocol].photos.some((r) => r.role === role)) return { error: `Unknown photo role ${role}.` };
      await store.supersede(active.id, role);
      const kept = (await store.pendingEvidence(account.id)).filter((e) => e.kind === "photo").pop();
      if (kept) {
        await store.attachEvidence([kept.id], active.id);
        await store.setEvidenceRole(kept.id, role);
      }
      if (active.status === "unresolved") await store.updateClaim(active.id, { status: "collecting" });
      return status(deps, account, session);
    }
    case "verify_claim": {
      const s = await status(deps, account, session);
      if (!s.open_claim?.ready_to_verify) return { error: "Not ready: evidence is missing.", status: s };
      if (session.verifications_today >= deps.limits.verificationsPerDay) return { error: "Daily verification limit reached. Try again tomorrow." };
      session.verifications_today++;
      try {
        const r = await verifyClaim(deps.meta, store, s.open_claim.claim_id, now);
        deps.log?.("verified", { claim: r.claim.id, outcome: r.check.decision.outcome });
        if (r.check.decision.outcome !== "unresolved") session.open_claim_id = null;
        return {
          outcome: r.check.decision.outcome,
          reasons: r.check.decision.reasons,
          ecoin_credited: r.credit?.amount ?? 0,
          ledger_entry: r.credit ? `#${r.credit.seq}` : null,
          what_the_ai_saw: r.check.observation.notes,
          better_evidence: r.check.observation.better_evidence,
          evidence_file: `${deps.publicUrl}/claim.html?id=${r.claim.id}`,
          next: r.claim.protocol === "tree_planting" && r.check.decision.outcome === "consistent" ? "Remind them to send a survival photo from the same spot in 30 days for 400 more ECOIN." : undefined,
        };
      } catch (e) {
        session.verifications_today--;
        deps.log?.("verify_error", String(e));
        return { error: "Verification is temporarily unavailable. The evidence is saved; ask them to try again later." };
      }
    }
    case "wallet": {
      const entries = await store.ledgerOf(account.id, 5);
      return {
        balance_ecoin: await store.balance(account.id),
        recent: entries.map((e) => ({ seq: e.seq, amount: e.amount, memo: e.memo, at: e.at.slice(0, 10) })),
        wallet_page: `${deps.publicUrl}/ledger.html?account=${account.id}`,
      };
    }
    case "cancel_action": {
      if (!active) return { error: "No open claim." };
      await store.updateClaim(active.id, { status: "cancelled" });
      session.open_claim_id = null;
      return { cancelled: true };
    }
  }
  return { error: `Unknown tool ${name}` };
}

async function attachPending(store: Store, accountId: string, claim: Claim) {
  const pending = await store.pendingEvidence(accountId);
  const p = PROTOCOLS[claim.protocol];
  const photos = pending.filter((e) => e.kind === "photo");
  for (let i = 0; i < Math.min(photos.length, p.photos.length); i++) {
    await store.attachEvidence([photos[i].id], claim.id);
    await store.setEvidenceRole(photos[i].id, p.photos[i].role);
  }
  const loc = pending.filter((e) => e.kind === "location").pop();
  if (loc) {
    await store.attachEvidence([loc.id], claim.id);
    await store.updateClaim(claim.id, { lat: loc.lat, lng: loc.lng });
  }
}

// ───────── conversation loop ─────────

function systemPrompt(state: unknown): string {
  return `You are ECO, a WhatsApp agent that pays people for verified climate action, anywhere in the world.
Always reply in the language the person writes in. WhatsApp style: short (under 70 words), warm, plain words, *bold* allowed, no headings.

Actions: ${STARTABLE.map((id) => `${id} — ${PROTOCOLS[id].summary}`).join(" | ")} | tree_survival — ${PROTOCOLS.tree_survival.summary}

How you work:
- When the person describes an action (or a kept-aside photo needs one), call start_action. For a 30-day tree photo, call start_survival_check.
- Then ask for exactly the next missing item in the state: the next photo (use its "ask"), or their location (WhatsApp 📎 → Location → Send your current location, taken where the action happened).
- When ready_to_verify is true, call verify_claim straight away — don't ask permission.
- After verify_claim: consistent → celebrate, say the ECOIN earned and give the evidence_file link. unresolved → kindly explain in one line and ask for the better_evidence (call redo_photo when they will resend a photo). contradicted → state the reason neutrally, never accuse; say they can start a new claim with new evidence.
- You cannot pay, change a result, or promise amounts other than the action rewards. Only verify_claim credits ECOIN, using Meta AI checks and fixed rules.
- Never ask for names, ID or money. Off-topic questions: answer in one line and steer back to climate action.

Current state (JSON): ${JSON.stringify(state)}`;
}

async function converse(deps: AgentDeps, account: Account, session: Session, userText: string): Promise<string> {
  const now = new Date();
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(await status(deps, account, session)) },
    ...session.history,
    { role: "user", content: userText },
  ];
  for (let turn = 0; turn < 4; turn++) {
    const { message } = await deps.meta.chat({ messages, tools: TOOLS, maxTokens: 600 });
    const calls = message.tool_calls ?? [];
    if (!calls.length) {
      const text = typeof message.content === "string" ? message.content.trim() : "";
      return text || "Sorry, could you say that again?";
    }
    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: calls });
    for (const c of calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(c.function.arguments || "{}"); } catch { /* invalid args → empty */ }
      const result = await runTool(deps, account, session, c.function.name, args, now);
      deps.log?.("tool", { name: c.function.name, args });
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(result) });
    }
  }
  return "I'm still working on that — please send your message again in a moment.";
}
