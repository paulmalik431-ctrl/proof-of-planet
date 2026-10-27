// Web simulator: the same agent as WhatsApp, so judges can try ECO without a phone — as a person,
// a business, a shop, or an ECO reviewer, side by side. Same rules, same models, same ledger;
// sandbox numbers start with 999. Hard daily caps keep the public demo's cost bounded.
import { handle, type Inbound } from "../_core/agent.ts";
import { base64ToBytes, sha256Hex } from "../_core/index.ts";
import { cors, env, json, makeDeps, SANDBOX_PREFIX } from "../_shared/deps.ts";

const MAX_IMAGE_BYTES = 4_000_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let b: { session?: string; persona?: string; poll?: boolean; text?: string; image?: string; mime?: string; lat?: number; lng?: number };
  try { b = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  if (!b.session || !/^[a-z0-9]{8,40}$/i.test(b.session)) return json({ error: "session required" }, 400);
  const persona = ["person", "business", "shop", "reviewer"].includes(b.persona ?? "") ? b.persona! : "person";
  const digits = BigInt("0x" + (await sha256Hex(`${b.session}:${persona}`)).slice(0, 12)) % 1_000_000_000n;
  const phone = SANDBOX_PREFIX + digits.toString().padStart(9, "0");

  const deps = makeDeps({ messagesPerDay: Number(env("SIM_MESSAGES_PER_SESSION", "60")), verificationsPerDay: Number(env("SIM_VERIFICATIONS_PER_SESSION", "6")) });
  const account = await deps.store.accountByPhone(phone);
  if (b.poll) return json({ replies: [], inbox: account ? await deps.store.drain(account.id) : [], phone, account_id: account?.id ?? null });

  if ((await deps.store.bump("simulator")) > Number(env("SIM_DAILY_CAP", "500"))) {
    return json({ replies: ["The public demo has reached today's limit. Please come back tomorrow, or message ECO on WhatsApp."], inbox: [], phone });
  }
  const base = { id: `sim_${crypto.randomUUID()}`, from: phone, at: new Date() };
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
    const a = await deps.store.accountByPhone(phone);
    // Sandbox reviewers: the reviewer persona may decide disputes between sandbox accounts only.
    if (a && persona === "reviewer" && a.consent_at && !a.roles.includes("ops")) await deps.store.updateAccount(a.id, { roles: [...a.roles, "ops"] });
    return json({ replies, inbox: a ? await deps.store.drain(a.id) : [], phone, account_id: a?.id ?? null });
  } catch (e) {
    console.error("simulate failed", String(e));
    return json({ replies: ["Sorry, something went wrong on our side. Please try again."], inbox: [], phone });
  }
});
