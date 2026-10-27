// Glance — spend ECOIN every day: shops, buses, apps. No card, no cash, no bank account.
// The shop enters the customer's phone number and the amount. The customer confirms with
// their face (on the roadmap) or with a one-time code ECO sends to their WhatsApp.
// Codes are stored only as salted hashes, expire in 5 minutes and allow 3 attempts.
import { sha256Hex } from "./ledger.ts";

export const CODE_TTL_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 3;
export const MAX_PAYMENT = 50_000;

export interface Payment {
  id: string;
  shop: string;
  customer: string;
  amount: number;
  status: "pending" | "paid" | "expired" | "failed" | "cancelled";
  method: "whatsapp_code" | "face";
  code_hash: string;
  attempts: number;
  expires_at: string;
  created_at: string;
  paid_at: string | null;
}

export function newCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

export const hashCode = (paymentId: string, code: string) => sha256Hex(`${paymentId}:${code}`);

export type CodeCheck = "ok" | "wrong" | "expired" | "locked" | "not_pending";

export async function checkCode(p: Payment, code: string, now: Date): Promise<CodeCheck> {
  if (p.status !== "pending") return "not_pending";
  if (Date.parse(p.expires_at) < now.getTime()) return "expired";
  if (p.attempts >= MAX_ATTEMPTS) return "locked";
  return (await hashCode(p.id, code.trim())) === p.code_hash ? "ok" : "wrong";
}

/** Normalises a phone number as typed by a cashier: digits only, no leading +/00. */
export function normalisePhone(s: string): string {
  return s.replace(/[^\d]/g, "").replace(/^00/, "");
}

/**
 * Face step (roadmap). Meta's models are not face-recognition models, and biometric checks need a
 * certified provider, explicit consent and a data-protection impact assessment. The design is fixed:
 * 1:1 match against the face the customer enrolled on their own phone, keyed to their phone number —
 * never a searchable face database, and nothing biometric on the ledger. Until a provider is plugged in,
 * Glance runs on the WhatsApp code.
 */
export interface FaceVerifier {
  verify(customerAccountId: string, liveSelfie: Uint8Array): Promise<{ match: boolean; score: number }>;
}
