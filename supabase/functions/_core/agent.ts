// The ECO agent on WhatsApp. Muse Spark 1.3 talks with people in their own language and works
// through tools (tools.ts). Ordinary code files photos and locations. Money moves only inside
// tools that apply fixed rules: Witness mints for verified action, Loop escrows trades,
// Glance needs the customer's code. The model can talk, look and ask. It cannot move money.
import type { ChatMessage, MetaClient } from "./meta.ts";
import { nextMissingPhoto, PROTOCOLS, STARTABLE } from "./protocols.ts";
import { sha256Hex } from "./ledger.ts";
import { MATERIALS } from "./loop.ts";
import type { Account, Session, Store } from "./store.ts";
import { type Ctx, enterCode, runTool, state, toolsFor } from "./tools.ts";

export interface Inbound {
  id: string;
  from: string; // phone number (digits) or simulator number
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
  publicUrl: string;
  limits: { messagesPerDay: number; verificationsPerDay: number };
  /** Delivers a message to another account (WhatsApp send, or the simulator inbox). Defaults to store.enqueue. */
  notify?: (accountId: string, text: string) => Promise<void>;
  /** True for simulator numbers: sandbox reviewers may only decide sandbox disputes. */
  isSandbox?: (phone: string) => boolean;
  transcribe?: (audio: { bytes: Uint8Array; mime: string }) => Promise<string | null>;
  log?: (event: string, data?: unknown) => void;
}

export const CONSENT_TEXT = [
  "🌍 *ECO · Proof of Planet*",
  "Earn ECOIN for verified climate action, sell sorted recyclables to businesses, and pay in shops — all here on WhatsApp.",
  "",
  "Meta AI checks your photos. Your photos and the place you share become a public *Evidence File* so anyone can check the work. Your phone number is never shown.",
  "",
  "This test version runs on Meta's free developer credits, so Meta may use what you send here to improve its products.",
  "",
  "Reply *YES* to agree. Write in any language.",
].join("\n");

const YES = /^\s*(yes|y|ok|okay|ndio|sawa|oui|s[ií]|ja|sim|haan|ha|evet|да|نعم|是|好|はい|네)\b/i;
const HISTORY = 16;

export async function handle(deps: AgentDeps, msg: Inbound): Promise<string[]> {
  const { store } = deps;
  if (await store.seen(msg.id)) return [];
  const account = (await store.accountByPhone(msg.from)) ?? (await store.createAccount(msg.from));

  if (!account.consent_at) {
    if (msg.kind === "text" && YES.test(msg.text ?? "")) {
      await store.updateAccount(account.id, { consent_at: msg.at.toISOString() });
      return [welcome(deps, account)];
    }
    return [CONSENT_TEXT];
  }

  const day = msg.at.toISOString().slice(0, 10);
  const session: Session = (await store.session(account.id)) ?? { account_id: account.id, history: [], open_claim_id: null, open_listing_id: null, last_location: null, day, messages_today: 0, verifications_today: 0 };
  session.open_listing_id ??= null;
  session.last_location ??= null;
  if (session.day !== day) Object.assign(session, { day, messages_today: 0, verifications_today: 0 });
  session.messages_today++;
  if (session.messages_today > deps.limits.messagesPerDay) {
    await store.saveSession(session);
    return session.messages_today === deps.limits.messagesPerDay + 1 ? ["You've reached today's message limit. Come back tomorrow 🌱"] : [];
  }
  const c: Ctx = { deps, account, session, now: msg.at };

  // Glance shortcut: a shop typing the customer's 6-digit code needs no model call.
  if (msg.kind === "text" && /^\s*\d{6}\s*$/.test(msg.text ?? "") && account.roles.includes("shop") && (await store.pendingPaymentsOf(account.id)).length) {
    const r = await enterCode(c, msg.text!.trim());
    await store.saveSession(session);
    return [r.error ? `❌ ${r.error}` : `✅ Paid: ${r.paid} ECOIN. You receive ${r.shop_received} (fee ${r.fee}, of which ${r.to_reserve} goes to the ECO Reserve).`];
  }

  const userText = await fileInbound(c, msg);
  const reply = await converse(c, userText);
  session.history = [...session.history, { role: "user" as const, content: userText }, { role: "assistant" as const, content: reply }].slice(-HISTORY);
  await store.saveSession(session);
  return [reply];
}

function welcome(deps: AgentDeps, a: Account): string {
  return [
    `Welcome to ECO 🌱 Your wallet: *${a.id}*`,
    "",
    "*Earn* — plant a tree, clean up a place or recycle; send photos and Meta AI verifies them.",
    "*Trade* — sell waste to businesses that turn it into value on *Loop* (rice husk → briquettes, coffee pulp → compost, bottles → recyclers), paid through escrow.",
    "*Spend* — pay in shops with *Glance*: just your phone number and a WhatsApp code.",
    "",
    `What did you do for the climate today? How it works: ${deps.publicUrl}`,
  ].join("\n");
}

/** Files photos and locations by plain code, then describes what happened for the model. */
async function fileInbound(c: Ctx, msg: Inbound): Promise<string> {
  const { store } = c.deps;
  const { account, session } = c;
  const open = session.open_claim_id ? await store.claim(session.open_claim_id) : null;
  const active = open && (open.status === "collecting" || open.status === "unresolved") ? open : null;
  const draft = session.open_listing_id ? await store.listing(session.open_listing_id) : null;
  const listing = draft && draft.status === "draft" ? draft : null;

  if (msg.kind === "text") return msg.text ?? "";

  if (msg.kind === "image" && msg.image) {
    const sha = await sha256Hex(msg.image.bytes);
    const path = await store.savePhoto(msg.image.bytes, msg.image.mime);
    const caption = msg.image.caption ? ` Caption: "${msg.image.caption}".` : "";
    if (active) {
      const p = PROTOCOLS[active.protocol];
      const have = (await store.evidenceOf(active.id)).filter((e) => e.kind === "photo").map((e) => e.role!);
      let role = nextMissingPhoto(p, have)?.role ?? null;
      if (!role && p.photos.length === 1) { role = p.photos[0].role; await store.supersede(active.id, role); }
      if (role) {
        await store.addEvidence({ claim_id: active.id, account_id: account.id, kind: "photo", role, path, sha256: sha, lat: null, lng: null, text: null });
        if (active.status === "unresolved") await store.updateClaim(active.id, { status: "collecting" });
        return `[sent a photo — filed as "${role}" for the ${p.title} claim]${caption}`;
      }
    }
    if (listing) {
      await store.updateListing(listing.id, { photo_path: path, photo_sha256: sha });
      return `[sent a photo — filed as the lot photo for the ${MATERIALS[listing.material].title} listing]${caption}`;
    }
    await store.addEvidence({ claim_id: null, account_id: account.id, kind: "photo", role: null, path, sha256: sha, lat: null, lng: null, text: null });
    return `[sent a photo — kept aside (it may be a new action, a lot to sell, or a delivery photo for a trade)]${caption}`;
  }

  if (msg.kind === "location" && msg.location) {
    const { lat, lng } = msg.location;
    session.last_location = { lat, lng };
    if (active) {
      await store.updateClaim(active.id, { lat, lng });
      await store.addEvidence({ claim_id: active.id, account_id: account.id, kind: "location", role: null, path: null, sha256: null, lat, lng, text: null });
      if (active.status === "unresolved") await store.updateClaim(active.id, { status: "collecting" });
      return `[shared a location — filed for the ${PROTOCOLS[active.protocol].title} claim]`;
    }
    if (listing) {
      await store.updateListing(listing.id, { lat, lng });
      return "[shared a location — filed as the pickup point for the listing]";
    }
    await store.addEvidence({ claim_id: null, account_id: account.id, kind: "location", role: null, path: null, sha256: null, lat, lng, text: null });
    return "[shared a location — kept aside and remembered as their current location]";
  }

  if (msg.kind === "audio" && msg.audio) {
    const t = c.deps.transcribe ? await c.deps.transcribe(msg.audio).catch(() => null) : null;
    return t ? `[voice note, transcribed by Muse] ${t}` : "[sent a voice note that could not be transcribed — ask them to type instead]";
  }
  return "[sent a message type ECO can't read — ask for text, a photo or a location]";
}

function systemPrompt(s: unknown, roles: string[]): string {
  return `You are ECO, the WhatsApp agent of ECO · Proof of Planet: people earn ECOIN for verified climate action, trade recyclables, and spend ECOIN in shops. Anywhere in the world.
Reply in the language the person writes in. WhatsApp style: under 70 words, warm, plain, *bold* allowed, no headings. Use short trade ids like #a1b2c3.

EARN (Witness): ${STARTABLE.map((id) => `${id}: ${PROTOCOLS[id].summary}`).join(" | ")} | tree_survival: ${PROTOCOLS.tree_survival.summary}
- Describe an action → start_action. Then ask for exactly the next missing item (next_photo_needed.ask, or location: 📎 → Location → current location, taken where the action happened).
- When ready_to_verify → call verify_claim at once. consistent → celebrate, ECOIN minted, evidence_file link. unresolved → kindly ask for better_evidence (redo_photo when they resend). contradicted → neutral reason, never accuse.
TRADE (Loop) — waste-to-value matching. Streams: ${Object.values(MATERIALS).map((m) => `${m.id} (${m.unit}) → ${m.becomes.join("/")}`).join("; ")}.
- Seller: sell_waste → tell them the one-time code to write on paper in the photo → ask for one photo of the whole lot with the code, and the pickup location → publish_listing (Meta AI identifies and grades it; the best buyer bid wins — you never set prices). After delivering: a delivery photo, then mark_delivered.
- Buyers are value-adders (briquette makers, composters, recyclers…): buy_waste posts their bid, accept_offer locks ECOIN in escrow, confirm_delivery records what they WEIGHED and accepted (they pay only for that), dispute_trade if nothing usable arrived (AI recommends, an ECO reviewer decides).
SPEND (Glance): shops use charge_customer then enter_code; the customer just reads the code ECO sent them. Face pay is coming; today it's the WhatsApp code.
Someone who says they are a business or shop → register_business / register_shop with their name.

Rules: you never move ECOIN yourself and never promise amounts; only the tools do, by fixed rules. Never ask for ID, card numbers or passwords. Off-topic: one line, then steer back.
Their roles: ${roles.join(", ")}.
Current state (JSON): ${JSON.stringify(s)}`;
}

async function converse(c: Ctx, userText: string): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(await state(c), c.account.roles) },
    ...c.session.history,
    { role: "user", content: userText },
  ];
  for (let turn = 0; turn < 5; turn++) {
    const { message } = await c.deps.meta.chat({ messages, tools: toolsFor(c.account.roles), maxTokens: 600 });
    const calls = message.tool_calls ?? [];
    if (!calls.length) {
      const text = typeof message.content === "string" ? message.content.trim() : "";
      return text || "Sorry, could you say that again?";
    }
    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: calls });
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* invalid args → empty */ }
      let result: unknown;
      try { result = await runTool(c, call.function.name, args); }
      catch (e) { c.deps.log?.("tool_error", { tool: call.function.name, error: String(e) }); result = { error: "That didn't work. Nothing was changed." }; }
      c.deps.log?.("tool", { name: call.function.name, args });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return "I'm still working on that — please send your message again in a moment.";
}
