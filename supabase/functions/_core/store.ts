// Storage interface used by the agent, Witness, Loop and Glance, plus an in-memory implementation
// for tests, the eval scripts and local runs. Production uses SupabaseStore.
import type { ChatMessage, ModelCallTrace } from "./meta.ts";
import type { ProtocolId } from "./protocols.ts";
import type { Decision, Observation } from "./rules.ts";
import { checkLegs, GENESIS, type Leg, type LedgerEntry, seal, SYSTEM } from "./ledger.ts";
import type { Demand, Listing, Trade } from "./loop.ts";
import type { Payment } from "./glance.ts";
import { hamming } from "./phash.ts";

export type Role = "person" | "business" | "shop" | "ops";

export interface Account {
  id: string;            // public pseudonym (never the phone number)
  phone: string;
  name: string | null;   // businesses and shops only
  roles: Role[];
  consent_at: string | null;
  created_at: string;
}

export type ClaimStatus = "collecting" | "verifying" | "consistent" | "unresolved" | "contradicted" | "cancelled";

export interface Claim {
  id: string;
  account_id: string;
  protocol: ProtocolId;
  parent_id: string | null;
  status: ClaimStatus;
  lat: number | null;
  lng: number | null;
  reward: number;
  created_at: string;
  verified_at: string | null;
}

export interface Evidence {
  id: string;
  claim_id: string | null; // null while waiting for the person to say what it is for
  account_id: string;
  kind: "photo" | "location" | "voice";
  role: string | null;
  path: string | null;
  sha256: string | null;
  phash?: string | null;
  lat: number | null;
  lng: number | null;
  text: string | null;
  superseded: boolean;
  created_at: string;
}

export interface Check {
  id: string;
  claim_id: string;
  decision: Decision;
  observation: Observation;
  counts: Record<string, number>;
  boxes: Record<string, Array<{ x1: number; y1: number; x2: number; y2: number; w: number; h: number; c: number | null; label: string }>>;
  models: { segmentation: string; reasoning: string; calls: number; ms: number; trace?: ModelCallTrace[] };
  created_at: string;
}

export interface Session {
  account_id: string;
  history: ChatMessage[];
  open_claim_id: string | null;
  open_listing_id: string | null;
  last_location: { lat: number; lng: number } | null;
  day: string;
  messages_today: number;
  verifications_today: number;
}

export type New<T, K extends keyof T = never> = Omit<T, "id" | "created_at" | K>;

export interface Store {
  accountByPhone(phone: string): Promise<Account | null>;
  accountById(id: string): Promise<Account | null>;
  createAccount(phone: string): Promise<Account>;
  updateAccount(id: string, patch: Partial<Pick<Account, "name" | "roles" | "consent_at">>): Promise<void>;

  session(accountId: string): Promise<Session | null>;
  saveSession(s: Session): Promise<void>;

  createClaim(c: Pick<Claim, "account_id" | "protocol" | "parent_id"> & Partial<Pick<Claim, "lat" | "lng">>): Promise<Claim>;
  claim(id: string): Promise<Claim | null>;
  updateClaim(id: string, patch: Partial<Claim>): Promise<void>;
  claimsOf(accountId: string): Promise<Claim[]>;

  addEvidence(e: New<Evidence, "superseded">): Promise<Evidence>;
  evidenceOf(claimId: string): Promise<Evidence[]>;
  pendingEvidence(accountId: string): Promise<Evidence[]>;
  attachEvidence(ids: string[], claimId: string): Promise<void>;
  setEvidenceRole(id: string, role: string): Promise<void>;
  /** A kept-aside photo used for a listing or a delivery: hidden from "kept aside", record kept. */
  consumeEvidence(ids: string[]): Promise<void>;
  supersede(claimId: string, role: string): Promise<void>;
  /** Same image bytes already used in another claim or listing. */
  photoHashUsedElsewhere(sha256: string, ref: string): Promise<boolean>;
  photoNearDuplicate(phash: string, ref: string, maxDistance?: number): Promise<string | null>;

  addCheck(c: New<Check>): Promise<Check>;

  savePhoto(bytes: Uint8Array, mime: string): Promise<string>;
  photoDataUrl(path: string): Promise<string>;

  /** Atomically appends legs to the hash chain after checkLegs(); throws on any rule violation. */
  post(legs: Leg[], ref: string | null, memo: string): Promise<LedgerEntry[]>;
  balance(accountId: string): Promise<number>;
  ledgerOf(accountId: string, limit: number): Promise<LedgerEntry[]>;

  createListing(l: New<Listing>): Promise<Listing>;
  listing(id: string): Promise<Listing | null>;
  updateListing(id: string, patch: Partial<Listing>): Promise<void>;
  createDemand(d: New<Demand>): Promise<Demand>;
  openDemands(material: string): Promise<Demand[]>;
  openListings(material: string): Promise<Listing[]>;
  demandsOf(buyer: string): Promise<Demand[]>;
  updateDemand(id: string, patch: Partial<Demand>): Promise<void>;
  createTrade(t: New<Trade>): Promise<Trade>;
  trade(id: string): Promise<Trade | null>;
  updateTrade(id: string, patch: Partial<Trade>): Promise<void>;
  tradesOf(accountId: string): Promise<Trade[]>;
  disputedTrades(): Promise<Trade[]>;

  createPayment(p: New<Payment>): Promise<Payment>;
  payment(id: string): Promise<Payment | null>;
  updatePayment(id: string, patch: Partial<Payment>): Promise<void>;
  pendingPaymentsOf(shop: string): Promise<Payment[]>;

  /** Messages for people other than the sender (simulator inbox; WhatsApp sends directly). */
  enqueue(accountId: string, text: string): Promise<void>;
  drain(accountId: string): Promise<string[]>;

  /** Records a message id; returns true if it was already processed (webhook retries). */
  seen(messageId: string): Promise<boolean>;
}

export const uid = () => crypto.randomUUID();
export const pseudonym = () => "eco_" + uid().replace(/-/g, "").slice(0, 12);

export class MemoryStore implements Store {
  accounts: Account[] = Object.values(SYSTEM).map((id) => ({ id, phone: `system:${id}`, name: id, roles: [], consent_at: null, created_at: new Date(0).toISOString() }));
  sessions = new Map<string, Session>();
  claims: Claim[] = [];
  evidence: Evidence[] = [];
  checks: Check[] = [];
  ledger: LedgerEntry[] = [];
  listings: Listing[] = [];
  demands: Demand[] = [];
  trades: Trade[] = [];
  payments: Payment[] = [];
  outbox: Array<{ account_id: string; text: string }> = [];
  photos = new Map<string, { bytes: Uint8Array; mime: string }>();
  seenIds = new Set<string>();
  constructor(private now: () => Date = () => new Date()) {}
  private ts() { return this.now().toISOString(); }
  private add<T>(arr: T[], v: Record<string, unknown>): T { const x = { ...v, id: uid(), created_at: this.ts() } as T; arr.push(x); return structuredClone(x); }
  private patch<T extends { id: string }>(arr: T[], id: string, p: Partial<T>) { const x = arr.find((r) => r.id === id); if (x) Object.assign(x, structuredClone(p)); }
  private get<T extends { id: string }>(arr: T[], id: string) { const x = arr.find((r) => r.id === id); return x ? structuredClone(x) : null; }

  async accountByPhone(phone: string) { const a = this.accounts.find((x) => x.phone === phone); return a ? structuredClone(a) : null; }
  async accountById(id: string) { return this.get(this.accounts, id); }
  async createAccount(phone: string) {
    const a: Account = { id: pseudonym(), phone, name: null, roles: ["person"], consent_at: null, created_at: this.ts() };
    this.accounts.push(a);
    return structuredClone(a);
  }
  async updateAccount(id: string, p: Partial<Account>) { this.patch(this.accounts, id, p); }

  async session(id: string) { const s = this.sessions.get(id); return s ? structuredClone(s) : null; }
  async saveSession(s: Session) { this.sessions.set(s.account_id, structuredClone(s)); }

  async createClaim(c: Parameters<Store["createClaim"]>[0]) {
    return this.add<Claim>(this.claims, { lat: null, lng: null, ...c, status: "collecting", reward: 0, verified_at: null });
  }
  async claim(id: string) { return this.get(this.claims, id); }
  async updateClaim(id: string, p: Partial<Claim>) { this.patch(this.claims, id, p); }
  async claimsOf(a: string) { return this.claims.filter((c) => c.account_id === a).map((c) => structuredClone(c)); }

  async addEvidence(e: New<Evidence, "superseded">) { return this.add<Evidence>(this.evidence, { ...e, superseded: false }); }
  async evidenceOf(claimId: string) { return this.evidence.filter((e) => e.claim_id === claimId && !e.superseded).map((e) => structuredClone(e)); }
  async pendingEvidence(a: string) { return this.evidence.filter((e) => e.account_id === a && e.claim_id === null && !e.superseded).map((e) => structuredClone(e)); }
  async attachEvidence(ids: string[], claimId: string) { for (const e of this.evidence) if (ids.includes(e.id)) e.claim_id = claimId; }
  async setEvidenceRole(id: string, role: string) { this.patch(this.evidence, id, { role }); }
  async consumeEvidence(ids: string[]) { for (const e of this.evidence) if (ids.includes(e.id)) e.superseded = true; }
  async supersede(claimId: string, role: string) { for (const e of this.evidence) if (e.claim_id === claimId && e.role === role) e.superseded = true; }
  async photoHashUsedElsewhere(sha: string, ref: string) {
    return this.evidence.some((e) => e.sha256 === sha && e.claim_id !== null && e.claim_id !== ref)
      || this.listings.some((l) => l.photo_sha256 === sha && l.id !== ref && l.status !== "draft");
  }
  async photoNearDuplicate(phash: string, ref: string, maxDistance = 6) {
    const evidence = this.evidence.find((e) => e.phash && e.claim_id !== null && e.claim_id !== ref && hamming(e.phash, phash) <= maxDistance);
    if (evidence) return evidence.claim_id;
    const listing = this.listings.find((l) => l.photo_phash && l.id !== ref && l.status !== "draft" && hamming(l.photo_phash, phash) <= maxDistance);
    return listing?.id ?? null;
  }

  async addCheck(c: New<Check>) { return this.add<Check>(this.checks, c as unknown as Record<string, unknown>); }

  async savePhoto(bytes: Uint8Array, mime: string) { const p = `mem/${uid()}`; this.photos.set(p, { bytes, mime }); return p; }
  async photoDataUrl(path: string) {
    const p = this.photos.get(path);
    if (!p) throw new Error("photo not found");
    let bin = "";
    for (const b of p.bytes) bin += String.fromCharCode(b);
    return `data:${p.mime};base64,${btoa(bin)}`;
  }

  private bal(a: string) { return this.ledger.filter((e) => e.account_id === a).reduce((s, e) => s + e.amount, 0); }
  private posting: Promise<unknown> = Promise.resolve();
  /** Serialised like the SQL version (which locks the ledger table), so concurrent posts can't interleave. */
  post(legs: Leg[], ref: string | null, memo: string): Promise<LedgerEntry[]> {
    const run = this.posting.then(() => this.postNow(legs, ref, memo));
    this.posting = run.catch(() => {});
    return run;
  }
  private async postNow(legs: Leg[], ref: string | null, memo: string) {
    const err = checkLegs(legs, (a) => this.bal(a), ref, (r) => this.ledger.filter((e) => e.account_id === SYSTEM.escrow && e.ref === r).reduce((s, e) => s + e.amount, 0));
    if (err) throw new Error(err);
    const at = this.ts();
    const out: LedgerEntry[] = [];
    for (const l of legs) {
      const last = this.ledger[this.ledger.length - 1];
      const e = await seal({ ...l, ref, memo, seq: (last?.seq ?? 0) + 1, prev_hash: last?.hash ?? GENESIS, at });
      this.ledger.push(e);
      out.push(e);
    }
    return out;
  }
  async balance(a: string) { return this.bal(a); }
  async ledgerOf(a: string, limit: number) { return this.ledger.filter((e) => e.account_id === a).slice(-limit).reverse(); }

  async createListing(l: New<Listing>) { return this.add<Listing>(this.listings, l as unknown as Record<string, unknown>); }
  async listing(id: string) { return this.get(this.listings, id); }
  async updateListing(id: string, p: Partial<Listing>) { this.patch(this.listings, id, p); }
  async createDemand(d: New<Demand>) { return this.add<Demand>(this.demands, d as unknown as Record<string, unknown>); }
  async openDemands(m: string) { return this.demands.filter((d) => d.material === m && d.status === "open").map((d) => structuredClone(d)); }
  async openListings(m: string) { return this.listings.filter((l) => l.material === m && l.status === "open").map((l) => structuredClone(l)); }
  async demandsOf(b: string) { return this.demands.filter((d) => d.buyer === b).map((d) => structuredClone(d)); }
  async updateDemand(id: string, p: Partial<Demand>) { this.patch(this.demands, id, p); }
  async createTrade(t: New<Trade>) { return this.add<Trade>(this.trades, t as unknown as Record<string, unknown>); }
  async trade(id: string) { return this.get(this.trades, id); }
  async updateTrade(id: string, p: Partial<Trade>) { this.patch(this.trades, id, p); }
  async tradesOf(a: string) { return this.trades.filter((t) => t.buyer === a || t.seller === a).map((t) => structuredClone(t)); }
  async disputedTrades() { return this.trades.filter((t) => t.status === "disputed").map((t) => structuredClone(t)); }

  async createPayment(p: New<Payment>) { return this.add<Payment>(this.payments, p as unknown as Record<string, unknown>); }
  async payment(id: string) { return this.get(this.payments, id); }
  async updatePayment(id: string, p: Partial<Payment>) { this.patch(this.payments, id, p); }
  async pendingPaymentsOf(shop: string) { return this.payments.filter((p) => p.shop === shop && p.status === "pending").map((p) => structuredClone(p)); }

  async enqueue(account_id: string, text: string) { this.outbox.push({ account_id, text }); }
  async drain(a: string) { const mine = this.outbox.filter((m) => m.account_id === a); this.outbox = this.outbox.filter((m) => m.account_id !== a); return mine.map((m) => m.text); }

  async seen(id: string) { if (this.seenIds.has(id)) return true; this.seenIds.add(id); return false; }
}
