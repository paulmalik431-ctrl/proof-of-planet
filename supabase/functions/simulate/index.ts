// Web simulator: the same agent as WhatsApp, reachable from the demo page so judges can try
// ECO without a phone. Same rules, same models, same ledger — plus hard daily caps on cost.
import { handle, type Inbound } from "../_core/agent.ts";
import { base64ToBytes } from "../_core/meta.ts";
import { cors, env, json, makeDeps } from "../_shared/deps.ts";

const MAX_IMAGE_BYTES = 4_000_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let b: { session?: string; text?: string; image?: string; mime?: string; lat?: number; lng?: number };
  try { b = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  if (!b.session || !/^[a-z0-9]{8,40}$/i.test(b.session)) return json({ error: "session required" }, 400);

  const deps = makeDeps({ messagesPerDay: Number(env("SIM_MESSAGES_PER_SESSION", "40")), verificationsPerDay: Number(env("SIM_VERIFICATIONS_PER_SESSION", "4")) });
  const used = await deps.store.bump("simulator");
  if (used > Number(env("SIM_DAILY_CAP", "400"))) {
    return json({ replies: ["The public demo has reached today's limit. Please come back tomorrow, or message ECO on WhatsApp."] });
  }

  const base = { id: `sim_${crypto.randomUUID()}`, from: `sim_${b.session}`, at: new Date() };
  let msg: Inbound;
  if (b.image) {
    const bytes = base64ToBytes(b.image);
    if (bytes.length > MAX_IMAGE_BYTES) return json({ error: "image too large" }, 413);
    msg = { ...base, kind: "image", image: { bytes, mime: b.mime ?? "image/jpeg", caption: b.text } };
  } else if (typeof b.lat === "number" && typeof b.lng === "number") {
    msg = { ...base, kind: "location", location: { lat: b.lat, lng: b.lng } };
  } else {
    msg = { ...base, kind: "text", text: String(b.text ?? "").slice(0, 1000) };
  }

  try {
    const replies = await handle(deps, msg);
    const account = await deps.store.accountByPhone(base.from);
    return json({ replies, account_id: account?.id ?? null });
  } catch (e) {
    console.error("simulate failed", String(e));
    return json({ replies: ["Sorry, something went wrong on our side. Please try again."] }, 200);
  }
});
