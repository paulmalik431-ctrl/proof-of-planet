// Store backed by Supabase Postgres + Storage, used by the edge functions (service role).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Account, Check, Claim, Evidence, New, Session, Store } from "../_core/store.ts";
import { pseudonym } from "../_core/store.ts";
import type { Leg, LedgerEntry } from "../_core/ledger.ts";
import type { Demand, Listing, Trade } from "../_core/loop.ts";
import type { Payment } from "../_core/glance.ts";
import { bytesToDataUrl } from "../_core/meta.ts";

const BUCKET = "evidence";
type R<T> = { data: T | null; error: { message: string; code?: string } | null };

function must<T>(r: R<T>, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export class SupabaseStore implements Store {
  readonly db: SupabaseClient;
  constructor(url = Deno.env.get("SUPABASE_URL")!, key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!) {
    this.db = createClient(url, key, { auth: { persistSession: false } });
  }
  private one<T>(table: string, col: string, val: string) { return this.db.from(table).select("*").eq(col, val).maybeSingle() as unknown as Promise<R<T>>; }
  private async ins<T>(table: string, row: object, what: string): Promise<T> { return must(await this.db.from(table).insert(row).select().single(), what) as T; }
  private async upd(table: string, id: string, patch: object, what: string) { must(await this.db.from(table).update(patch).eq("id", id), what); }

  async accountByPhone(phone: string) { return must(await this.one<Account>("accounts", "phone", phone), "account"); }
  async accountById(id: string) { return must(await this.one<Account>("accounts", "id", id), "account"); }
  async createAccount(phone: string) {
    const r = await this.db.from("accounts").upsert({ id: pseudonym(), phone }, { onConflict: "phone", ignoreDuplicates: true }).select().maybeSingle();
    if (r.error) throw new Error("create account: " + r.error.message);
    return (r.data as Account) ?? (await this.accountByPhone(phone))!;
  }
  async updateAccount(id: string, patch: Partial<Account>) { await this.upd("accounts", id, patch, "update account"); }

  async session(id: string) {
    const r = must(await this.db.from("sessions").select("data").eq("account_id", id).maybeSingle(), "session") as { data: Session } | null;
    return r?.data ?? null;
  }
  async saveSession(s: Session) { must(await this.db.from("sessions").upsert({ account_id: s.account_id, data: s, updated_at: new Date().toISOString() }), "save session"); }

  async createClaim(c: Parameters<Store["createClaim"]>[0]) { return this.ins<Claim>("claims", c, "create claim"); }
  async claim(id: string) { return must(await this.one<Claim>("claims", "id", id), "claim"); }
  async updateClaim(id: string, p: Partial<Claim>) { await this.upd("claims", id, p, "update claim"); }
  async claimsOf(a: string) { return must(await this.db.from("claims").select("*").eq("account_id", a).order("created_at"), "claims") as Claim[]; }

  async addEvidence(e: New<Evidence, "superseded">) { return this.ins<Evidence>("evidence", e, "add evidence"); }
  async evidenceOf(claimId: string) { return must(await this.db.from("evidence").select("*").eq("claim_id", claimId).eq("superseded", false).order("created_at"), "evidence") as Evidence[]; }
  async pendingEvidence(a: string) { return must(await this.db.from("evidence").select("*").eq("account_id", a).is("claim_id", null).eq("superseded", false).order("created_at"), "pending") as Evidence[]; }
  async attachEvidence(ids: string[], claimId: string) { if (ids.length) must(await this.db.from("evidence").update({ claim_id: claimId }).in("id", ids), "attach"); }
  async setEvidenceRole(id: string, role: string) { await this.upd("evidence", id, { role }, "set role"); }
  async consumeEvidence(ids: string[]) { if (ids.length) must(await this.db.from("evidence").update({ superseded: true }).in("id", ids), "consume"); }
  async supersede(claimId: string, role: string) { must(await this.db.from("evidence").update({ superseded: true }).eq("claim_id", claimId).eq("role", role), "supersede"); }
  async photoHashUsedElsewhere(sha: string, ref: string) {
    const [e, l] = await Promise.all([
      this.db.from("evidence").select("id").eq("sha256", sha).not("claim_id", "is", null).neq("claim_id", ref).limit(1),
      this.db.from("listings").select("id").eq("photo_sha256", sha).neq("id", ref).neq("status", "draft").limit(1),
    ]);
    return (must(e, "dup") as unknown[]).length > 0 || (must(l, "dup") as unknown[]).length > 0;
  }

  async addCheck(c: New<Check>) { return this.ins<Check>("checks", c, "add check"); }

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

  async post(legs: Leg[], ref: string | null, memo: string) {
    const r = await this.db.rpc("ledger_post", { p_legs: legs, p_ref: ref, p_memo: memo });
    if (r.error) throw new Error(r.error.message);
    return (r.data as LedgerEntry[]).map((e) => ({ ...e, seq: Number(e.seq) }));
  }
  async balance(a: string) {
    const rows = must(await this.db.from("ledger").select("amount").eq("account_id", a), "balance") as { amount: number }[];
    return rows.reduce((s, r) => s + r.amount, 0);
  }
  async ledgerOf(a: string, limit: number) {
    return (must(await this.db.from("ledger").select("*").eq("account_id", a).order("seq", { ascending: false }).limit(limit), "ledger") as LedgerEntry[]).map((e) => ({ ...e, seq: Number(e.seq) }));
  }

  async createListing(l: New<Listing>) { return this.ins<Listing>("listings", l, "create listing"); }
  async listing(id: string) { return must(await this.one<Listing>("listings", "id", id), "listing"); }
  async updateListing(id: string, p: Partial<Listing>) { await this.upd("listings", id, p, "update listing"); }
  async createDemand(d: New<Demand>) { return this.ins<Demand>("demands", d, "create demand"); }
  async openDemands(m: string) { return must(await this.db.from("demands").select("*").eq("material", m).eq("status", "open").order("created_at"), "demands") as Demand[]; }
  async openListings(m: string) { return must(await this.db.from("listings").select("*").eq("material", m).eq("status", "open").order("created_at"), "listings") as Listing[]; }
  async demandsOf(b: string) { return must(await this.db.from("demands").select("*").eq("buyer", b), "demands") as Demand[]; }
  async updateDemand(id: string, p: Partial<Demand>) { await this.upd("demands", id, p, "update demand"); }
  async createTrade(t: New<Trade>) { return this.ins<Trade>("trades", t, "create trade"); }
  async trade(id: string) { return must(await this.one<Trade>("trades", "id", id), "trade"); }
  async updateTrade(id: string, p: Partial<Trade>) { await this.upd("trades", id, p, "update trade"); }
  async tradesOf(a: string) { return must(await this.db.from("trades").select("*").or(`buyer.eq.${a},seller.eq.${a}`).order("created_at"), "trades") as Trade[]; }
  async disputedTrades() { return must(await this.db.from("trades").select("*").eq("status", "disputed").order("created_at"), "disputes") as Trade[]; }

  async createPayment(p: New<Payment>) { return this.ins<Payment>("payments", p, "create payment"); }
  async payment(id: string) { return must(await this.one<Payment>("payments", "id", id), "payment"); }
  async updatePayment(id: string, p: Partial<Payment>) { await this.upd("payments", id, p, "update payment"); }
  async pendingPaymentsOf(shop: string) { return must(await this.db.from("payments").select("*").eq("shop", shop).eq("status", "pending").order("created_at"), "payments") as Payment[]; }

  async enqueue(accountId: string, text: string) { must(await this.db.from("outbox").insert({ account_id: accountId, text }), "enqueue"); }
  async drain(accountId: string) {
    const rows = must(await this.db.from("outbox").select("id,text").eq("account_id", accountId).is("delivered_at", null).order("id"), "outbox") as { id: number; text: string }[];
    if (rows.length) must(await this.db.from("outbox").update({ delivered_at: new Date().toISOString() }).in("id", rows.map((r) => r.id)), "outbox delivered");
    return rows.map((r) => r.text);
  }

  async seen(id: string) {
    const r = await this.db.from("seen_messages").insert({ id });
    if (r.error?.code === "23505") return true;
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
