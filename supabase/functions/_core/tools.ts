// The agent's tools. Each one enforces its own rules; the model only chooses which to call.
// Money moves in exactly four places, all rule-bound: verify_claim (mint for verified action),
// accept_offer (buyer → escrow), confirm_delivery / resolve_dispute (escrow → seller/buyer, with fees),
// and Glance code confirmation (customer → shop, with fees).
import type { ToolDef } from "./meta.ts";
import { nextMissingPhoto, PROTOCOLS, type ProtocolId, STARTABLE } from "./protocols.ts";
import { verifyClaim } from "./verify.ts";
import { assessLot, bestMatch, type Demand, type Grade, type Intake, type Listing, MATERIALS, type MaterialId, mediate, newChallenge, type Trade } from "./loop.ts";
import { escrowLock, escrowRefund, escrowRelease, escrowSplit, payment as paymentLegs } from "./money.ts";
import { checkCode, CODE_TTL_MS, hashCode, MAX_PAYMENT, newCode, normalisePhone } from "./glance.ts";
import type { AgentDeps as Deps } from "./agent.ts";
import type { Account, Claim, Role, Session, Store } from "./store.ts";
import type { AgentDeps } from "./agent.ts";

export interface Ctx { deps: AgentDeps; account: Account; session: Session; now: Date }

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolDef =>
  ({ type: "function", function: { name, description, parameters: { type: "object", properties, required } } });
const MATERIAL = { type: "string", enum: Object.keys(MATERIALS) };
const TRADE_ID = { type: "string", description: "trade id or its first characters" };
const GRADE = { type: "string", enum: ["A", "B", "C"] };

const WITNESS: ToolDef[] = [
  fn("start_action", "Witness: start a climate-action claim. Kept-aside photos and location attach automatically.", { action: { type: "string", enum: STARTABLE } }, ["action"]),
  fn("start_survival_check", "Witness: start the 30-day survival check for the person's oldest tree that is due."),
  fn("redo_photo", "Witness: mark one photo of the open claim to be replaced by the next (or a kept-aside) photo.", { role: { type: "string" } }, ["role"]),
  fn("verify_claim", "Witness: run Meta AI verification on the open claim when ready_to_verify is true. Pays automatically if consistent."),
  fn("cancel_action", "Cancel the open claim (only if the person asks)."),
];
const LOOP_SELLER: ToolDef[] = [
  fn("sell_waste", "Loop: start selling a waste stream to businesses that add value to it (e.g. rice husk to briquette makers). Returns a one-time code the seller writes on paper and puts in the photo.", { material: MATERIAL, quantity: { type: "number", description: "in the material's unit (kg, items or litres)" }, min_price: { type: "number", description: "optional lowest acceptable ECOIN per unit" } }, ["material", "quantity"]),
  fn("publish_listing", "Loop: when the draft listing has its photo (with the code) and location, Meta AI identifies and grades it, then the best buyer bid is matched."),
  fn("mark_delivered", "Loop (seller): after delivering, with the delivery photo sent (it is kept aside), tell the buyer to confirm.", { trade_id: TRADE_ID }, ["trade_id"]),
  fn("respond_to_dispute", "Loop (seller): give the seller's side of a disputed trade.", { trade_id: TRADE_ID, statement: { type: "string" } }, ["trade_id", "statement"]),
  fn("my_trades", "Loop: the person's trades and their status."),
];
const COMMON: ToolDef[] = [
  fn("wallet", "ECOIN balance, recent ledger entries and wallet link."),
  fn("register_business", "Register this WhatsApp number as a business that buys recyclables on Loop.", { name: { type: "string" } }, ["name"]),
  fn("register_shop", "Register this WhatsApp number as a shop that accepts ECOIN with Glance.", { name: { type: "string" } }, ["name"]),
];
const BUSINESS: ToolDef[] = [
  fn("buy_waste", "Loop (business): post a standing bid for a waste stream you turn into value; matches open listings whose minimum is at or below your bid.", { material: MATERIAL, quantity: { type: "number" }, max_price: { type: "number", description: "your bid, ECOIN per unit" }, min_grade: GRADE, radius_km: { type: "number" } }, ["material", "quantity", "max_price"]),
  fn("accept_offer", "Loop (business): accept a proposed trade; the total is locked in escrow until delivery.", { trade_id: TRADE_ID }, ["trade_id"]),
  fn("decline_offer", "Loop (business): decline a proposed trade.", { trade_id: TRADE_ID }, ["trade_id"]),
  fn("confirm_delivery", "Loop (business): record the weighed intake. Escrow pays the seller for the accepted quantity at your bid; any difference returns to you.", { trade_id: TRADE_ID, accepted_quantity: { type: "number", description: "weighed and accepted, in the material's unit" }, grade: GRADE, note: { type: "string" } }, ["trade_id", "accepted_quantity"]),
  fn("dispute_trade", "Loop (business): the delivery was missing or not as listed. Meta AI reviews the evidence; an ECO reviewer decides.", { trade_id: TRADE_ID, reason: { type: "string" } }, ["trade_id", "reason"]),
  fn("top_up_test_ecoin", "Demo only: give this business 5,000 test ECOIN (once), clearly labelled on the ledger."),
];
const SHOP: ToolDef[] = [
  fn("charge_customer", "Glance (shop): charge a customer by phone number. ECO sends them a 6-digit code on WhatsApp.", { phone: { type: "string" }, amount: { type: "number" } }, ["phone", "amount"]),
  fn("enter_code", "Glance (shop): enter the 6-digit code the customer reads out.", { code: { type: "string" } }, ["code"]),
];
const OPS: ToolDef[] = [
  fn("list_disputes", "ECO reviewer: disputed trades with Meta AI's recommendation."),
  fn("resolve_dispute", "ECO reviewer: decide a dispute. You (a person) decide; the AI only recommends.", { trade_id: TRADE_ID, outcome: { type: "string", enum: ["release", "refund", "split"] }, seller_share_pct: { type: "number" }, note: { type: "string" } }, ["trade_id", "outcome", "note"]),
];

export function toolsFor(roles: Role[]): ToolDef[] {
  return [...WITNESS, ...LOOP_SELLER, ...COMMON, ...(roles.includes("business") ? BUSINESS : []), ...(roles.includes("shop") ? SHOP : []), ...(roles.includes("ops") ? OPS : [])];
}

export const short = (id: string) => id.slice(0, 6);
const link = (c: Ctx, page: string, id: string) => `${c.deps.publicUrl}/${page}?id=${id}`;

async function notify(c: Ctx, accountId: string, text: string) {
  if (c.deps.notify) await c.deps.notify(accountId, text);
  else await c.deps.store.enqueue(accountId, text);
}

async function findTrade(c: Ctx, idOrPrefix: string): Promise<Trade | null> {
  const p = String(idOrPrefix ?? "").trim().replace(/^#/, "").toLowerCase();
  if (!p) return null;
  const mine = await c.deps.store.tradesOf(c.account.id);
  const all = c.account.roles.includes("ops") ? [...mine, ...(await c.deps.store.disputedTrades())] : mine;
  return all.find((t) => t.id === p) ?? all.find((t) => t.id.startsWith(p)) ?? null;
}

const unitWord = (u: string) => (u === "items" ? "" : `${u} `);
const tradeLine = (t: Trade) => `#${short(t.id)} ${t.quantity} ${unitWord(t.unit)}${MATERIALS[t.material].title} at ${t.price}/${t.unit === "items" ? "item" : t.unit} · ${t.total} ECOIN · ${t.status}`;
const hist = (t: Trade, status: Trade["status"], note: string, now: Date) => [...t.history, { at: now.toISOString(), status, note }];

// ───────── state the model sees ─────────

export async function state(c: Ctx) {
  const { store } = c.deps;
  const { account, session } = c;
  const open = session.open_claim_id ? await store.claim(session.open_claim_id) : null;
  let claim = null;
  if (open && open.status !== "cancelled") {
    const p = PROTOCOLS[open.protocol];
    const have = (await store.evidenceOf(open.id)).filter((e) => e.kind === "photo").map((e) => e.role!);
    const next = nextMissingPhoto(p, have);
    claim = {
      claim_id: open.id, action: p.title, status: open.status, photos_received: have,
      next_photo_needed: next ? { role: next.role, ask: next.ask } : null,
      location_received: open.lat !== null,
      ready_to_verify: ["collecting", "unresolved"].includes(open.status) && !next && open.lat !== null,
    };
  }
  const draft = session.open_listing_id ? await store.listing(session.open_listing_id) : null;
  const trades = (await store.tradesOf(account.id)).filter((t) => !["released", "refunded", "settled", "declined"].includes(t.status));
  const pending = await store.pendingEvidence(account.id);
  return {
    you: { id: account.id, roles: account.roles, name: account.name },
    open_claim: claim,
    draft_listing: draft && draft.status === "draft" ? { id: short(draft.id), material: draft.material, quantity: draft.quantity, code_to_write_in_photo: draft.challenge, photo_received: !!draft.photo_path, location_received: draft.lat !== null } : null,
    active_trades: trades.map((t) => ({ id: short(t.id), role: t.seller === account.id ? "seller" : "buyer", what: tradeLine(t) })),
    kept_aside: { photos: pending.filter((e) => e.kind === "photo").length, location: pending.some((e) => e.kind === "location") },
    pending_charges: account.roles.includes("shop") ? (await store.pendingPaymentsOf(account.id)).map((p) => ({ amount: p.amount, expires_at: p.expires_at })) : undefined,
    disputes_to_review: account.roles.includes("ops") ? (await store.disputedTrades()).length : undefined,
    verifications_left_today: Math.max(0, c.deps.limits.verificationsPerDay - session.verifications_today),
  };
}

async function survivalDue(store: Store, accountId: string, now: Date) {
  const claims = await store.claimsOf(accountId);
  const checked = new Set(claims.filter((x) => x.protocol === "tree_survival" && x.status === "consistent").map((x) => x.parent_id));
  return claims.filter((x) => x.protocol === "tree_planting" && x.status === "consistent" && !checked.has(x.id)).map((x) => {
    const due = new Date(Date.parse(x.created_at) + PROTOCOLS.tree_survival.parent!.minDays * 86_400_000);
    return { planting_claim_id: x.id, due_on: due.toISOString().slice(0, 10), due_now: due <= now };
  });
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
  if (loc) { await store.attachEvidence([loc.id], claim.id); await store.updateClaim(claim.id, { lat: loc.lat, lng: loc.lng }); }
}

/** Uses a kept-aside photo/location for a draft listing. */
async function fillListing(store: Store, accountId: string, l: Listing, last: Session["last_location"]) {
  const pending = await store.pendingEvidence(accountId);
  const photo = pending.filter((e) => e.kind === "photo").pop();
  const patch: Partial<Listing> = {};
  void photo; // a photo sent before the code existed can't contain it; ask for a new one
  if (l.lat === null && last) { patch.lat = last.lat; patch.lng = last.lng; }
  if (Object.keys(patch).length) await store.updateListing(l.id, patch);
}

// ───────── dispatcher ─────────

export async function runTool(c: Ctx, name: string, a: Record<string, unknown>): Promise<unknown> {
  const { store, meta } = c.deps;
  const { account, session, now } = c;
  const open = session.open_claim_id ? await store.claim(session.open_claim_id) : null;
  const active = open && ["collecting", "unresolved"].includes(open.status) ? open : null;

  switch (name) {
    // ── Witness ──
    case "start_action": {
      const action = String(a.action) as ProtocolId;
      if (!STARTABLE.includes(action)) return { error: `Choose one of: ${STARTABLE.join(", ")}` };
      if (active) await store.updateClaim(active.id, { status: "cancelled" });
      const claim = await store.createClaim({ account_id: account.id, protocol: action, parent_id: null });
      session.open_claim_id = claim.id;
      await attachPending(store, account.id, claim);
      return state(c);
    }
    case "start_survival_check": {
      const due = (await survivalDue(store, account.id, now)).filter((d) => d.due_now);
      if (!due.length) return { error: "No tree is due for its survival check yet.", trees: await survivalDue(store, account.id, now) };
      if (active) await store.updateClaim(active.id, { status: "cancelled" });
      const claim = await store.createClaim({ account_id: account.id, protocol: "tree_survival", parent_id: due[0].planting_claim_id });
      session.open_claim_id = claim.id;
      await attachPending(store, account.id, claim);
      return state(c);
    }
    case "redo_photo": {
      if (!active) return { error: "No open claim." };
      const role = String(a.role);
      if (!PROTOCOLS[active.protocol].photos.some((r) => r.role === role)) return { error: `Unknown photo role ${role}.` };
      await store.supersede(active.id, role);
      const kept = (await store.pendingEvidence(account.id)).filter((e) => e.kind === "photo").pop();
      if (kept) { await store.attachEvidence([kept.id], active.id); await store.setEvidenceRole(kept.id, role); }
      if (active.status === "unresolved") await store.updateClaim(active.id, { status: "collecting" });
      return state(c);
    }
    case "verify_claim": {
      const s = await state(c);
      if (!s.open_claim?.ready_to_verify) return { error: "Not ready: evidence is missing.", state: s };
      if (session.verifications_today >= c.deps.limits.verificationsPerDay) return { error: "Daily verification limit reached. Try again tomorrow." };
      session.verifications_today++;
      try {
        const r = await verifyClaim(meta, store, s.open_claim.claim_id, now);
        if (r.check.decision.outcome !== "unresolved") session.open_claim_id = null;
        return {
          outcome: r.check.decision.outcome, reasons: r.check.decision.reasons,
          ecoin_minted: r.credit?.amount ?? 0, ledger_entry: r.credit ? `#${r.credit.seq}` : null,
          what_the_ai_saw: r.check.observation.notes, better_evidence: r.check.observation.better_evidence,
          evidence_file: link(c, "claim.html", r.claim.id),
          next: r.claim.protocol === "tree_planting" && r.check.decision.outcome === "consistent" ? "Remind them: a survival photo from the same spot after 30 days earns 400 more." : undefined,
        };
      } catch (e) {
        session.verifications_today--;
        c.deps.log?.("verify_error", String(e));
        return { error: "Verification is temporarily unavailable. The evidence is saved; try again later." };
      }
    }
    case "cancel_action": {
      if (!active) return { error: "No open claim." };
      await store.updateClaim(active.id, { status: "cancelled" });
      session.open_claim_id = null;
      return { cancelled: true };
    }

    // ── Loop: selling ──
    case "sell_waste": {
      const material = String(a.material) as MaterialId;
      const m = MATERIALS[material];
      const quantity = Math.floor(Number(a.quantity));
      if (!m) return { error: `Materials: ${Object.keys(MATERIALS).join(", ")}` };
      if (!(quantity > 0 && quantity <= 100_000)) return { error: "Quantity must be a positive number." };
      const minPrice = Math.max(0, Math.floor(Number(a.min_price) || 0));
      const challenge = newChallenge();
      const l = await store.createListing({ seller: account.id, material, quantity, unit: m.unit, price: minPrice, grade: null, sam_count: 0, challenge, photo_path: null, photo_sha256: null, lat: null, lng: null, status: "draft", assessment: null });
      session.open_listing_id = l.id;
      await fillListing(store, account.id, l, session.last_location);
      return { ...(await state(c)), ask: `Write the code ${challenge} on a piece of paper, put it next to the ${m.title.toLowerCase()} and send one photo of the whole lot; then share the pickup location.`, becomes: m.becomes, buyers: m.buyers };
    }
    case "publish_listing": {
      const l = session.open_listing_id ? await store.listing(session.open_listing_id) : null;
      if (!l || l.status !== "draft") return { error: "No draft listing. Use sell_waste first." };
      if (!l.photo_path || l.lat === null) return { error: "Need the lot photo and the pickup location first.", state: await state(c) };
      if (session.verifications_today >= c.deps.limits.verificationsPerDay) return { error: "Daily check limit reached. Try again tomorrow." };
      if (l.photo_sha256 && await store.photoHashUsedElsewhere(l.photo_sha256, l.id)) {
        await store.updateListing(l.id, { status: "cancelled" });
        session.open_listing_id = null;
        return { outcome: "rejected", reasons: ["This exact photo was already used for another claim or listing."] };
      }
      session.verifications_today++;
      const m = MATERIALS[l.material];
      let as;
      try { as = await assessLot(meta, m, l.quantity, await store.photoDataUrl(l.photo_path), l.challenge); }
      catch (e) { session.verifications_today--; c.deps.log?.("assess_error", String(e)); return { error: "The check is temporarily unavailable. Try again shortly." }; }
      if (as.outcome !== "listed") {
        await store.updateListing(l.id, { assessment: as, sam_count: as.sam_count, photo_path: as.outcome === "rejected" ? l.photo_path : null, status: as.outcome === "rejected" ? "cancelled" : "draft" });
        if (as.outcome === "rejected") session.open_listing_id = null;
        return { outcome: as.outcome, reasons: as.reasons, what_the_ai_saw: as.observation.notes, next: as.outcome === "needs_better_photo" ? "Ask for a better photo, then call publish_listing again." : undefined };
      }
      await store.updateListing(l.id, { assessment: as, sam_count: as.sam_count, grade: as.grade, quantity: as.verified_quantity, status: "open" });
      session.open_listing_id = null;
      const listed = (await store.listing(l.id))!;
      const offer = await proposeFromListing(c, listed);
      return {
        outcome: "listed", grade: as.grade, counted: `${as.sam_count} ${m.counts}`, quantity: as.verified_quantity, unit: m.unit,
        what_the_ai_saw: as.observation.notes, listing_page: link(c, "listing.html", l.id),
        match: offer ? `Best bid: ${offer.price} ECOIN per ${m.unit === "items" ? "item" : m.unit} from a buyer ${offer.distance_km ?? "?"} km away (trade #${short(offer.id)}, ${offer.total} ECOIN). You'll get a message when they pay into escrow.` : `No bid yet from ${m.buyers.join(", ")}. You'll get a message when one comes in.`,
      };
    }
    case "mark_delivered": {
      const t = await findTrade(c, String(a.trade_id));
      if (!t || t.seller !== account.id) return { error: "Trade not found." };
      if (t.status !== "escrowed") return { error: `Trade is ${t.status}; delivery can be marked only after the buyer pays into escrow.` };
      const photo = (await store.pendingEvidence(account.id)).filter((e) => e.kind === "photo").pop();
      if (!photo) return { error: "Send a photo of the delivered goods first." };
      await store.consumeEvidence([photo.id]);
      await store.updateTrade(t.id, { status: "delivered", delivery_photo_path: photo.path, history: hist(t, "delivered", "Seller marked delivered with a photo", now) });
      await notify(c, t.buyer, `📦 Loop #${short(t.id)}: the seller says ${t.quantity} ${MATERIALS[t.material].title} were delivered. Check them, then reply *confirm ${short(t.id)}* to release ${t.total} ECOIN from escrow, or *dispute ${short(t.id)}* with the reason.\n${link(c, "trade.html", t.id)}`);
      return { status: "delivered", told_buyer: true };
    }
    case "respond_to_dispute": {
      const t = await findTrade(c, String(a.trade_id));
      if (!t || t.seller !== account.id || t.status !== "disputed") return { error: "No open dispute on that trade." };
      const statement = String(a.statement ?? "").slice(0, 500);
      const mediation = await runMediation(c, t, statement).catch(() => t.mediation);
      await store.updateTrade(t.id, { mediation, history: hist(t, "disputed", `Seller: ${statement}`, now) });
      return { recorded: true, note: "An ECO reviewer will decide. Meta AI's recommendation is only advice." };
    }
    case "my_trades": {
      const ts = await store.tradesOf(account.id);
      return { trades: ts.slice(-8).map((t) => ({ id: short(t.id), you_are: t.seller === account.id ? "seller" : "buyer", what: tradeLine(t), page: link(c, "trade.html", t.id) })) };
    }

    // ── common ──
    case "wallet": {
      const entries = await store.ledgerOf(account.id, 5);
      return { balance_ecoin: await store.balance(account.id), recent: entries.map((e) => ({ seq: e.seq, amount: e.amount, kind: e.kind, memo: e.memo })), wallet_page: `${c.deps.publicUrl}/ledger.html?account=${account.id}` };
    }
    case "register_business":
    case "register_shop": {
      const role: Role = name === "register_business" ? "business" : "shop";
      const nm = String(a.name ?? "").trim().slice(0, 60);
      if (nm.length < 2) return { error: "A name is needed." };
      const roles = Array.from(new Set([...account.roles, role]));
      await store.updateAccount(account.id, { roles, name: nm });
      account.roles = roles;
      account.name = nm;
      return role === "business"
        ? { registered: nm, next: "Share the drop-off location, then use buy_waste. In this demo, top_up_test_ecoin gives 5,000 test ECOIN." }
        : { registered: nm, next: "To get paid: charge_customer with their phone number and amount; they read you the WhatsApp code; enter_code." };
    }

    // ── Loop: buying ──
    case "buy_waste": {
      if (!account.roles.includes("business")) return { error: "Register as a business first." };
      const material = String(a.material) as MaterialId;
      if (!MATERIALS[material]) return { error: `Materials: ${Object.keys(MATERIALS).join(", ")}` };
      const quantity = Math.floor(Number(a.quantity));
      const max_price = Math.floor(Number(a.max_price));
      if (!(quantity > 0) || !(max_price > 0)) return { error: "Quantity and max price must be positive." };
      const min_grade = (["A", "B", "C"].includes(String(a.min_grade)) ? String(a.min_grade) : "C") as Grade;
      const d = await store.createDemand({ buyer: account.id, material, quantity, max_price, min_grade, lat: session.last_location?.lat ?? null, lng: session.last_location?.lng ?? null, radius_km: Math.min(200, Math.max(1, Number(a.radius_km) || 25)), status: "open" });
      const offers: string[] = [];
      let remaining = quantity;
      for (const l of await store.openListings(material)) {
        if (remaining <= 0) break;
        const m = bestMatch(l, [{ ...d, quantity: remaining }]);
        if (m) { remaining -= m.quantity; const t = await createTrade(c, l, d, m.quantity, m.distance_km, m.price, false); offers.push(`#${short(t.id)}: ${t.quantity} from a seller ${t.distance_km ?? "?"} km away at ${t.price} = ${t.total} ECOIN (grade ${l.grade})`); }
      }
      return { demand_posted: true, matched_offers: offers, next: offers.length ? "Accept with accept_offer to lock the ECOIN in escrow." : "No listings match yet; you'll be messaged when one does.", location_used: session.last_location ? "last shared location" : "none — share a location so distance can be matched" };
    }
    case "accept_offer": {
      const t = await findTrade(c, String(a.trade_id));
      if (!t || t.buyer !== account.id) return { error: "Offer not found." };
      if (t.status !== "proposed") return { error: `This trade is ${t.status}.` };
      try { await store.post(escrowLock(account.id, t.total), t.id, `Loop escrow #${short(t.id)}`); }
      catch { return { error: `Not enough ECOIN: ${t.total} needed, balance ${await store.balance(account.id)}.` }; }
      const intakeCode = newCode();
      await store.updateTrade(t.id, { status: "escrowed", intake_code_hash: await hashCode(t.id, intakeCode), history: hist(t, "escrowed", `${t.total} ECOIN locked in escrow`, now) });
      await store.updateListing(t.listing_id, { status: "reserved" });
      await notify(c, t.seller, `🔒 Loop #${short(t.id)}: ${account.name ?? "a buyer"} paid ${t.total} ECOIN into escrow for your ${t.quantity} ${unitWord(t.unit)}${MATERIALS[t.material].title}. Deliver them, send a photo of the delivery, and say *delivered ${short(t.id)}*. You're paid for what the buyer weighs and accepts, at ${t.price} per ${t.unit === "items" ? "item" : t.unit}.`);
      return { escrowed: t.total, intake: `When the goods arrive, weigh them and reply "confirm ${short(t.id)} <quantity>", or record it on the intake page with code ${intakeCode}: ${c.deps.publicUrl}/intake.html?id=${t.id}`, trade_page: link(c, "trade.html", t.id) };
    }
    case "decline_offer": {
      const t = await findTrade(c, String(a.trade_id));
      if (!t || t.buyer !== account.id || t.status !== "proposed") return { error: "Offer not found." };
      await store.updateTrade(t.id, { status: "declined", history: hist(t, "declined", "Buyer declined", now) });
      await store.updateListing(t.listing_id, { status: "open" });
      return { declined: true };
    }
    case "confirm_delivery": {
      const t = await findTrade(c, String(a.trade_id));
      if (!t || t.buyer !== account.id) return { error: "Trade not found." };
      const g = ["A", "B", "C"].includes(String(a.grade)) ? (String(a.grade) as Grade) : null;
      return settleIntake(c.deps, t, { accepted_quantity: Number(a.accepted_quantity), grade: g, note: String(a.note ?? "").slice(0, 300), by: account.id, via: "whatsapp", at: now.toISOString() }, now);
    }
    case "dispute_trade": {
      const t = await findTrade(c, String(a.trade_id));
      if (!t || t.buyer !== account.id) return { error: "Trade not found." };
      if (!["delivered", "escrowed"].includes(t.status)) return { error: `This trade is ${t.status}.` };
      const reason = String(a.reason ?? "").slice(0, 500);
      const disputed = { ...t, dispute: { by: account.id, reason, at: now.toISOString() } };
      const mediation = await runMediation(c, disputed, "").catch((e) => { c.deps.log?.("mediation_error", String(e)); return null; });
      await store.updateTrade(t.id, { status: "disputed", dispute: disputed.dispute, mediation, history: hist(t, "disputed", `Buyer: ${reason}`, now) });
      await notify(c, t.seller, `⚠️ Loop #${short(t.id)}: the buyer disputes the delivery: "${reason}". The ECOIN stays in escrow. Reply with your side; an ECO reviewer decides.`);
      return { disputed: true, escrow_held: t.total, ai_recommendation: mediation ? `${mediation.recommendation} (${mediation.seller_share_pct}% to seller): ${mediation.reasoning}` : "pending", note: "A person at ECO decides; the AI only recommends." };
    }
    case "top_up_test_ecoin": {
      if (!account.roles.includes("business")) return { error: "Only businesses can get test ECOIN." };
      if ((await store.ledgerOf(account.id, 1000)).some((e) => e.kind === "deposit")) return { error: "Test ECOIN was already given to this business." };
      const [e] = await store.post([{ account_id: account.id, amount: 5000, kind: "deposit" }], null, "Test deposit (demo only)");
      return { deposited: 5000, ledger_entry: `#${e.seq}` };
    }

    // ── Glance ──
    case "charge_customer": {
      if (!account.roles.includes("shop")) return { error: "Register as a shop first." };
      const phone = normalisePhone(String(a.phone ?? ""));
      const amount = Math.floor(Number(a.amount));
      if (!(amount > 0 && amount <= MAX_PAYMENT)) return { error: `Amount must be 1–${MAX_PAYMENT} ECOIN.` };
      const customer = await store.accountByPhone(phone);
      if (!customer || !customer.consent_at) return { error: "That number has no ECO wallet. They can start one by messaging ECO on WhatsApp." };
      if (customer.id === account.id) return { error: "A shop can't charge itself." };
      for (const p of await store.pendingPaymentsOf(account.id)) await store.updatePayment(p.id, { status: "cancelled" });
      const code = newCode();
      const p = await store.createPayment({ shop: account.id, customer: customer.id, amount, status: "pending", method: "whatsapp_code", code_hash: "", attempts: 0, expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(), paid_at: null });
      await store.updatePayment(p.id, { code_hash: await hashCode(p.id, code) });
      await notify(c, customer.id, `🧾 *${account.name}* is charging you *${amount} ECOIN*.\nYour Glance code: *${code}*\nOnly read it to the cashier if you agree. It expires in 5 minutes. Balance: ${await store.balance(customer.id)} ECOIN.`);
      return { code_sent_to_customer: true, next: "Ask the customer for the 6-digit code from their WhatsApp, then enter_code." };
    }
    case "enter_code": return enterCode(c, String(a.code ?? ""));

    // ── ECO reviewer ──
    case "list_disputes": {
      if (!account.roles.includes("ops")) return { error: "Reviewers only." };
      const open = [];
      for (const t of await store.disputedTrades()) if (await canReview(c, t)) open.push(t);
      return { disputes: open.map((t) => ({ id: short(t.id), what: tradeLine(t), buyer_says: t.dispute?.reason, ai: t.mediation, page: link(c, "trade.html", t.id) })) };
    }
    case "resolve_dispute": {
      if (!account.roles.includes("ops")) return { error: "Reviewers only." };
      const t = await findTrade(c, String(a.trade_id));
      if (!t || t.status !== "disputed" || !(await canReview(c, t))) return { error: "No open dispute with that id." };
      if (t.buyer === account.id || t.seller === account.id) return { error: "You can't decide a dispute you are part of." };
      const outcome = String(a.outcome) as "release" | "refund" | "split";
      const pct = outcome === "release" ? 100 : outcome === "refund" ? 0 : Math.max(1, Math.min(99, Math.round(Number(a.seller_share_pct) || 50)));
      const note = String(a.note ?? "").slice(0, 300);
      const toSeller = Math.round((t.total * pct) / 100);
      if (outcome === "refund") await store.post(escrowRefund(t.buyer, t.total), t.id, `Loop refund #${short(t.id)}`);
      else if (outcome === "release") await store.post(escrowRelease(t.seller, t.total).legs, t.id, `Loop trade #${short(t.id)} (reviewed)`);
      else await store.post(escrowSplit(t.seller, t.buyer, t.total, toSeller).legs, t.id, `Loop settlement #${short(t.id)}`);
      await store.updateTrade(t.id, { decision: { outcome, seller_share_pct: pct, by: account.id, note, at: now.toISOString() } });
      await settle(c, t, outcome === "refund" ? "refunded" : outcome === "release" ? "released" : "settled", `Reviewer decided: ${outcome} (${pct}% to seller). ${note}`);
      const msg = `⚖️ Loop #${short(t.id)} decided by an ECO reviewer: ${outcome}${outcome === "split" ? ` (${pct}% to the seller)` : ""}. ${note}\n${link(c, "trade.html", t.id)}`;
      await notify(c, t.buyer, msg);
      await notify(c, t.seller, msg);
      return { decided: outcome, seller_share_pct: pct, ai_had_recommended: t.mediation?.recommendation ?? null };
    }
  }
  return { error: `Unknown tool ${name}` };
}

/** Sandbox reviewers (the web simulator) may only review trades between sandbox accounts. */
async function canReview(c: Ctx, t: Trade): Promise<boolean> {
  const sb = c.deps.isSandbox;
  if (!sb || !sb(c.account.phone)) return true;
  const [b, s] = await Promise.all([c.deps.store.accountById(t.buyer), c.deps.store.accountById(t.seller)]);
  return !!b && !!s && sb(b.phone) && sb(s.phone);
}

export async function enterCode(c: Ctx, code: string): Promise<Record<string, unknown>> {
  const { store } = c.deps;
  const p = (await store.pendingPaymentsOf(c.account.id)).pop();
  if (!p) return { error: "No pending charge. Use charge_customer first." };
  const r = await checkCode(p, code, c.now);
  if (r === "expired") { await store.updatePayment(p.id, { status: "expired" }); return { error: "The code expired. Charge again." }; }
  if (r === "locked") { await store.updatePayment(p.id, { status: "failed" }); return { error: "Too many wrong codes. Charge again." }; }
  if (r === "wrong") { await store.updatePayment(p.id, { attempts: p.attempts + 1 }); return { error: `Wrong code (${2 - p.attempts} tries left).` }; }
  if (r !== "ok") return { error: "This charge is no longer pending." };
  const { legs, split } = paymentLegs(p.customer, p.shop, p.amount);
  try { await store.post(legs, p.id, `Glance · ${c.account.name}`); }
  catch { await store.updatePayment(p.id, { status: "failed" }); await notify(c, p.customer, `❌ Payment to ${c.account.name} failed: not enough ECOIN.`); return { error: "The customer doesn't have enough ECOIN." }; }
  await store.updatePayment(p.id, { status: "paid", paid_at: c.now.toISOString() });
  await notify(c, p.customer, `✅ Paid ${p.amount} ECOIN to ${c.account.name}. Balance: ${await store.balance(p.customer)} ECOIN.\n${c.deps.publicUrl}/ledger.html?account=${p.customer}`);
  return { paid: p.amount, shop_received: split.net, fee: split.fee, to_reserve: split.reserve };
}

async function runMediation(c: Ctx, t: Trade, sellerStatement: string) {
  const { store } = c.deps;
  const l = await store.listing(t.listing_id);
  const lp = l?.photo_path ? await store.photoDataUrl(l.photo_path).catch(() => null) : null;
  const dp = t.delivery_photo_path ? await store.photoDataUrl(t.delivery_photo_path).catch(() => null) : null;
  return mediate(c.deps.meta, t, lp, dp, { buyer: t.dispute?.reason ?? "", seller: sellerStatement });
}

async function settle(c: Ctx, t: Trade, status: Trade["status"], note: string) {
  await closeTrade(c.deps.store, t, status, note, c.now);
}

async function closeTrade(store: Store, t: Trade, status: Trade["status"], note: string, now: Date) {
  const fresh = (await store.trade(t.id))!;
  await store.updateTrade(t.id, { status, history: hist(fresh, status, note, now) });
  if (status === "refunded") { await store.updateListing(t.listing_id, { status: "open" }); return; }
  await store.updateListing(t.listing_id, { status: "sold" });
  const d = (await store.demandsOf(t.buyer)).find((x) => x.id === t.demand_id);
  if (d) {
    const left = Math.max(0, d.quantity - t.quantity);
    await store.updateDemand(d.id, { quantity: left, status: left === 0 ? "filled" : d.status });
  }
}

/**
 * The buyer's weighed intake — the second witness. Pays the seller for the accepted quantity at the agreed bid
 * (fees + Reserve), returns any difference to the buyer, and records who weighed what. Shared by the WhatsApp
 * tool and the web intake page. A zero intake is not a refund: it must go through a dispute and a human reviewer.
 */
export async function settleIntake(deps: Deps, t: Trade, intake: Intake, now: Date): Promise<Record<string, unknown>> {
  const { store } = deps;
  if (!["delivered", "escrowed"].includes(t.status)) return { error: `This trade is ${t.status}.` };
  const q = Number(intake.accepted_quantity);
  const unit = t.unit === "items" ? "items" : t.unit;
  if (!Number.isFinite(q) || q <= 0) return { error: "Accepted quantity must be more than zero. If nothing usable arrived, open a dispute instead." };
  if (q > t.quantity) return { error: `Accepted quantity can't exceed the ${t.quantity} ${unit} paid into escrow. Record the extra as a new trade.` };
  const accepted = t.unit === "items" ? Math.floor(q) : Math.round(q * 10) / 10;
  const toSeller = Math.min(t.total, Math.round(accepted * t.price));
  const fullRelease = toSeller === t.total;
  const { legs, split } = fullRelease ? escrowRelease(t.seller, t.total) : escrowSplit(t.seller, t.buyer, t.total, toSeller);
  await store.post(legs, t.id, `Loop trade #${short(t.id)}`);
  await store.updateTrade(t.id, { intake: { ...intake, accepted_quantity: accepted } });
  const refunded = t.total - toSeller;
  await closeTrade(store, t, "released", `Buyer weighed and accepted ${accepted} ${unit}${intake.grade ? ` (grade ${intake.grade})` : ""} via ${intake.via}. Seller paid ${split.net}; fees ${split.fee} (reserve ${split.reserve})${refunded ? `; ${refunded} returned to buyer` : ""}.`, now);
  const msg = `✅ Loop #${short(t.id)}: the buyer weighed and accepted ${accepted} ${unit}. +${split.net} ECOIN (after ${split.fee} ECOIN fees, ${split.reserve} of it to the ECO Reserve).\n${deps.publicUrl}/trade.html?id=${t.id}`;
  if (deps.notify) await deps.notify(t.seller, msg); else await store.enqueue(t.seller, msg);
  return { accepted_quantity: accepted, seller_received: split.net, fees: split.fee, to_reserve: split.reserve, returned_to_buyer: refunded, receipt: `${deps.publicUrl}/trade.html?id=${t.id}` };
}

async function createTrade(c: Ctx, l: Listing, d: Demand, quantity: number, distance_km: number | null, price: number, tellBuyer: boolean) {
  const { store } = c.deps;
  const t = await store.createTrade({
    listing_id: l.id, demand_id: d.id, seller: l.seller, buyer: d.buyer, material: l.material, quantity, unit: l.unit, price, total: price * quantity, intake: null, intake_code_hash: null,
    distance_km, status: "proposed", delivery_photo_path: null, dispute: null, mediation: null, decision: null,
    history: [{ at: c.now.toISOString(), status: "proposed", note: "Matched by Loop" }],
  });
  await store.updateListing(l.id, { status: "reserved" });
  if (tellBuyer) {
    await notify(c, d.buyer, `♻️ New Loop offer #${short(t.id)}: ${quantity} ${unitWord(l.unit)}${MATERIALS[l.material].title} (grade ${l.grade}, checked by Meta AI) from a seller ${distance_km ?? "?"} km away, at your bid of ${price} ECOIN = *${t.total} ECOIN* (you pay for what you weigh and accept).\nReply *accept ${short(t.id)}* to pay into escrow, or *decline ${short(t.id)}*.\n${link(c, "listing.html", l.id)}`);
  }
  return t;
}

async function proposeFromListing(c: Ctx, l: Listing) {
  const m = bestMatch(l, await c.deps.store.openDemands(l.material));
  if (!m) return null;
  return createTrade(c, l, m.demand, m.quantity, m.distance_km, m.price, true);
}
