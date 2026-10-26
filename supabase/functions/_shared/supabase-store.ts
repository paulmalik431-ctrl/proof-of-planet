// Store backed by Supabase Postgres + Storage, used by the edge functions (service role).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Account, Check, Claim, Evidence, Session, Store } from "../_core/store.ts";
import type { LedgerEntry } from "../_core/ledger.ts";
import { bytesToDataUrl } from "../_core/meta.ts";

const BUCKET = "evidence";

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export class SupabaseStore implements Store {
  readonly db: SupabaseClient;
  constructor(url = Deno.env.get("SUPABASE_URL")!, key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!) {
    this.db = createClient(url, key, { auth: { persistSession: false } });
  }

  async accountByPhone(phone: string) {
    return must(await this.db.from("accounts").select("*").eq("phone", phone).maybeSingle(), "account") as Account | null;
  }
  async createAccount(phone: string) {
    const id = "eco_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const r = await this.db.from("accounts").upsert({ id, phone }, { onConflict: "phone", ignoreDuplicates: true }).select().maybeSingle();
    if (r.error) throw new Error("create account: " + r.error.message);
    return (r.data as Account) ?? (await this.accountByPhone(phone))!;
  }
  async setConsent(id: string, at: string) {
    must(await this.db.from("accounts").update({ consent_at: at }).eq("id", id), "consent");
  }

  async session(id: string) {
    const r = must(await this.db.from("sessions").select("data").eq("account_id", id).maybeSingle(), "session") as { data: Session } | null;
    return r?.data ?? null;
  }
  async saveSession(s: Session) {
    must(await this.db.from("sessions").upsert({ account_id: s.account_id, data: s, updated_at: new Date().toISOString() }), "save session");
  }

  async createClaim(c: Parameters<Store["createClaim"]>[0]) {
    return must(await this.db.from("claims").insert(c).select().single(), "create claim") as Claim;
  }
  async claim(id: string) {
    return must(await this.db.from("claims").select("*").eq("id", id).maybeSingle(), "claim") as Claim | null;
  }
  async updateClaim(id: string, patch: Partial<Claim>) {
    must(await this.db.from("claims").update(patch).eq("id", id), "update claim");
  }
  async claimsOf(accountId: string) {
    return must(await this.db.from("claims").select("*").eq("account_id", accountId).order("created_at"), "claims") as Claim[];
  }

  async addEvidence(e: Parameters<Store["addEvidence"]>[0]) {
    return must(await this.db.from("evidence").insert(e).select().single(), "add evidence") as Evidence;
  }
  async evidenceOf(claimId: string) {
    return must(await this.db.from("evidence").select("*").eq("claim_id", claimId).eq("superseded", false).order("created_at"), "evidence") as Evidence[];
  }
  async pendingEvidence(accountId: string) {
    return must(await this.db.from("evidence").select("*").eq("account_id", accountId).is("claim_id", null).eq("superseded", false).order("created_at"), "pending") as Evidence[];
  }
  async attachEvidence(ids: string[], claimId: string) {
    if (ids.length) must(await this.db.from("evidence").update({ claim_id: claimId }).in("id", ids), "attach");
  }
  async setEvidenceRole(id: string, role: string) {
    must(await this.db.from("evidence").update({ role }).eq("id", id), "set role");
  }
  async supersede(claimId: string, role: string) {
    must(await this.db.from("evidence").update({ superseded: true }).eq("claim_id", claimId).eq("role", role), "supersede");
  }
  async photoHashUsedElsewhere(sha: string, claimId: string) {
    const r = must(await this.db.from("evidence").select("id").eq("sha256", sha).not("claim_id", "is", null).neq("claim_id", claimId).limit(1), "dup") as unknown[];
    return r.length > 0;
  }

  async addCheck(c: Omit<Check, "id" | "created_at">) {
    return must(await this.db.from("checks").insert(c).select().single(), "add check") as Check;
  }

  async savePhoto(bytes: Uint8Array, mime: string) {
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const r = await this.db.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
    if (r.error) throw new Error("upload: " + r.error.message);
    return path;
  }
  async photoDataUrl(path: string) {
    const r = await this.db.storage.from(BUCKET).download(path);
    if (r.error || !r.data) throw new Error("download: " + (r.error?.message ?? "empty"));
    return bytesToDataUrl(new Uint8Array(await r.data.arrayBuffer()), r.data.type || "image/jpeg");
  }

  async appendLedger(e: Parameters<Store["appendLedger"]>[0]) {
    const r = await this.db.rpc("ledger_append", { p_account: e.account_id, p_amount: e.amount, p_kind: e.kind, p_claim: e.claim_id, p_memo: e.memo });
    if (r.error) throw new Error("ledger: " + r.error.message);
    const row = (Array.isArray(r.data) ? r.data[0] : r.data) as LedgerEntry;
    return { ...row, seq: Number(row.seq) };
  }
  async balance(accountId: string) {
    const rows = must(await this.db.from("ledger").select("amount").eq("account_id", accountId), "balance") as { amount: number }[];
    return rows.reduce((s, r) => s + r.amount, 0);
  }
  async ledgerOf(accountId: string, limit: number) {
    return must(await this.db.from("ledger").select("*").eq("account_id", accountId).order("seq", { ascending: false }).limit(limit), "ledger") as LedgerEntry[];
  }

  async seen(id: string) {
    const r = await this.db.from("seen_messages").insert({ id });
    if (r.error && r.error.code === "23505") return true;
    if (r.error) throw new Error("seen: " + r.error.message);
    return false;
  }

  /** Atomic per-day counter for cost caps. */
  async bump(bucket: string): Promise<number> {
    const r = await this.db.rpc("usage_bump", { p_bucket: bucket });
    if (r.error) throw new Error("usage: " + r.error.message);
    return Number(r.data);
  }
}
