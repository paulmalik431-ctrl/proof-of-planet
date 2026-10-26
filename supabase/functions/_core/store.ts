// Storage interface used by the agent and verifier, plus an in-memory implementation
// for tests, the eval scripts and local runs. Production uses SupabaseStore.
import type { ChatMessage } from "./meta.ts";
import type { ProtocolId } from "./protocols.ts";
import type { Decision, Observation } from "./rules.ts";
import { GENESIS, type LedgerEntry, seal, utcIso } from "./ledger.ts";

export interface Account {
  id: string;            // public pseudonym (never the phone number)
  phone: string;
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
  claim_id: string | null; // null while waiting for the person to say which action it is
  account_id: string;
  kind: "photo" | "location" | "voice";
  role: string | null;
  path: string | null;     // storage path of the photo
  sha256: string | null;
  lat: number | null;
  lng: number | null;
  text: string | null;     // transcript for voice
  superseded: boolean;     // replaced by a better photo
  created_at: string;
}

export interface Check {
  id: string;
  claim_id: string;
  decision: Decision;
  observation: Observation;
  counts: Record<string, number>;
  boxes: Record<string, Array<{ x1: number; y1: number; x2: number; y2: number; w: number; h: number; c: number | null; label: string }>>;
  models: { segmentation: string; reasoning: string; calls: number; ms: number };
  created_at: string;
}

export interface Session {
  account_id: string;
  history: ChatMessage[];
  open_claim_id: string | null;
  day: string;          // YYYY-MM-DD, resets the counters
  messages_today: number;
  verifications_today: number;
}

export interface Store {
  accountByPhone(phone: string): Promise<Account | null>;
  createAccount(phone: string): Promise<Account>;
  setConsent(accountId: string, at: string): Promise<void>;

  session(accountId: string): Promise<Session | null>;
  saveSession(s: Session): Promise<void>;

  createClaim(c: Omit<Claim, "id" | "created_at" | "verified_at" | "reward" | "status" | "lat" | "lng"> & Partial<Pick<Claim, "lat" | "lng">>): Promise<Claim>;
  claim(id: string): Promise<Claim | null>;
  updateClaim(id: string, patch: Partial<Claim>): Promise<void>;
  claimsOf(accountId: string): Promise<Claim[]>;

  addEvidence(e: Omit<Evidence, "id" | "created_at" | "superseded">): Promise<Evidence>;
  evidenceOf(claimId: string): Promise<Evidence[]>;       // excludes superseded
  pendingEvidence(accountId: string): Promise<Evidence[]>; // claim_id null
  attachEvidence(ids: string[], claimId: string): Promise<void>;
  setEvidenceRole(id: string, role: string): Promise<void>;
  supersede(claimId: string, role: string): Promise<void>;
  photoHashUsedElsewhere(sha256: string, claimId: string): Promise<boolean>;

  addCheck(c: Omit<Check, "id" | "created_at">): Promise<Check>;

  savePhoto(bytes: Uint8Array, mime: string): Promise<string>; // returns storage path
  photoDataUrl(path: string): Promise<string>;                  // for model calls

  appendLedger(e: { account_id: string; amount: number; kind: LedgerEntry["kind"]; claim_id: string | null; memo: string }): Promise<LedgerEntry>;
  balance(accountId: string): Promise<number>;
  ledgerOf(accountId: string, limit: number): Promise<LedgerEntry[]>;

  /** Records a message id; returns true if it was already processed (webhook retries). */
  seen(messageId: string): Promise<boolean>;
}

export function uid(): string {
  return crypto.randomUUID();
}

export class MemoryStore implements Store {
  accounts: Account[] = [];
  sessions = new Map<string, Session>();
  claims: Claim[] = [];
  evidence: Evidence[] = [];
  checks: Check[] = [];
  ledger: LedgerEntry[] = [];
  photos = new Map<string, { bytes: Uint8Array; mime: string }>();
  seenIds = new Set<string>();
  constructor(private now: () => Date = () => new Date()) {}
  private ts() { return utcIso(this.now()); }

  async accountByPhone(phone: string) { return this.accounts.find((a) => a.phone === phone) ?? null; }
  async createAccount(phone: string) {
    const a: Account = { id: "eco_" + uid().replace(/-/g, "").slice(0, 12), phone, consent_at: null, created_at: this.ts() };
    this.accounts.push(a);
    return a;
  }
  async setConsent(id: string, at: string) { const a = this.accounts.find((x) => x.id === id); if (a) a.consent_at = at; }

  async session(id: string) { const s = this.sessions.get(id); return s ? structuredClone(s) : null; }
  async saveSession(s: Session) { this.sessions.set(s.account_id, structuredClone(s)); }

  async createClaim(c: Parameters<Store["createClaim"]>[0]) {
    const claim: Claim = { lat: null, lng: null, ...c, id: uid(), status: "collecting", reward: 0, created_at: this.ts(), verified_at: null };
    this.claims.push(claim);
    return { ...claim };
  }
  async claim(id: string) { const c = this.claims.find((x) => x.id === id); return c ? { ...c } : null; }
  async updateClaim(id: string, patch: Partial<Claim>) { const c = this.claims.find((x) => x.id === id); if (c) Object.assign(c, patch); }
  async claimsOf(accountId: string) { return this.claims.filter((c) => c.account_id === accountId).map((c) => ({ ...c })); }

  async addEvidence(e: Parameters<Store["addEvidence"]>[0]) {
    const ev: Evidence = { ...e, id: uid(), superseded: false, created_at: this.ts() };
    this.evidence.push(ev);
    return { ...ev };
  }
  async evidenceOf(claimId: string) { return this.evidence.filter((e) => e.claim_id === claimId && !e.superseded).map((e) => ({ ...e })); }
  async pendingEvidence(accountId: string) { return this.evidence.filter((e) => e.account_id === accountId && e.claim_id === null && !e.superseded).map((e) => ({ ...e })); }
  async attachEvidence(ids: string[], claimId: string) { for (const e of this.evidence) if (ids.includes(e.id)) e.claim_id = claimId; }
  async setEvidenceRole(id: string, role: string) { const e = this.evidence.find((x) => x.id === id); if (e) e.role = role; }
  async supersede(claimId: string, role: string) { for (const e of this.evidence) if (e.claim_id === claimId && e.role === role) e.superseded = true; }
  async photoHashUsedElsewhere(sha: string, claimId: string) {
    return this.evidence.some((e) => e.sha256 === sha && e.claim_id !== null && e.claim_id !== claimId);
  }

  async addCheck(c: Omit<Check, "id" | "created_at">) { const ch: Check = { ...c, id: uid(), created_at: this.ts() }; this.checks.push(ch); return ch; }

  async savePhoto(bytes: Uint8Array, mime: string) { const p = `mem/${uid()}`; this.photos.set(p, { bytes, mime }); return p; }
  async photoDataUrl(path: string) {
    const p = this.photos.get(path);
    if (!p) throw new Error("photo not found");
    let bin = "";
    for (const b of p.bytes) bin += String.fromCharCode(b);
    return `data:${p.mime};base64,${btoa(bin)}`;
  }

  async appendLedger(e: Parameters<Store["appendLedger"]>[0]) {
    const last = this.ledger[this.ledger.length - 1];
    const entry = await seal({ ...e, seq: (last?.seq ?? 0) + 1, prev_hash: last?.hash ?? GENESIS, at: this.ts() });
    this.ledger.push(entry);
    return entry;
  }
  async balance(id: string) { return this.ledger.filter((e) => e.account_id === id).reduce((s, e) => s + e.amount, 0); }
  async ledgerOf(id: string, limit: number) { return this.ledger.filter((e) => e.account_id === id).slice(-limit).reverse(); }

  async seen(id: string) { if (this.seenIds.has(id)) return true; this.seenIds.add(id); return false; }
}
