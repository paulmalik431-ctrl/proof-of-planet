// Buyer intake page backend: the value-adder records what they weighed and accepted, on their own phone,
// with the one-time code ECO sent them when they paid into escrow. This is the independent second witness:
// escrow pays the seller only for the accepted quantity, at the buyer's own bid.
import { hashCode } from "../_core/glance.ts";
import type { Grade } from "../_core/loop.ts";
import { settleIntake } from "../_core/tools.ts";
import { cors, json, makeDeps } from "../_shared/deps.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  let b: { trade_id?: string; code?: string; accepted_quantity?: number; grade?: string; note?: string };
  try { b = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  if (!b.trade_id || !/^[0-9a-f-]{36}$/i.test(b.trade_id)) return json({ error: "trade id required" }, 400);

  const deps = makeDeps({ messagesPerDay: 0, verificationsPerDay: 0 });
  if ((await deps.store.bump(`intake:${b.trade_id}`)) > 6) return json({ error: "Too many attempts today. Use WhatsApp, or contact ECO." }, 429);
  const t = await deps.store.trade(b.trade_id);
  if (!t || !t.intake_code_hash) return json({ error: "No trade waiting for intake." }, 404);
  if ((await hashCode(t.id, String(b.code ?? "").trim())) !== t.intake_code_hash) return json({ error: "That code doesn't match this trade." }, 403);

  const grade = ["A", "B", "C"].includes(String(b.grade)) ? (String(b.grade) as Grade) : null;
  const now = new Date();
  const r = await settleIntake(deps, t, { accepted_quantity: Number(b.accepted_quantity), grade, note: String(b.note ?? "").slice(0, 300), by: t.buyer, via: "web", at: now.toISOString() }, now);
  return json(r, r.error ? 422 : 200);
});
