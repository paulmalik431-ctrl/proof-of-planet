// One-time WhatsApp wiring, run server-side with the secrets already stored in Supabase (nobody sees them):
// 1) subscribe this app's webhook to the WhatsApp Business Account "messages" field;
// 2) subscribe the WhatsApp Business Account to this app so its messages are delivered here;
// 3) report the account's phone numbers and their status (the business number is public anyway).
// Options: ?find=1 lists every WhatsApp account the business owns, with ids, so nobody has to copy them by hand.
//          ?register=1 registers WHATSAPP_PHONE_NUMBER_ID on the Cloud API with the PIN in WHATSAPP_PIN.
// Idempotent and harmless to re-run: it only touches our own app, account and number. Reports status, never secrets.
import { cors, env, json } from "../_shared/deps.ts";

const APP_ID = "1137729232072325";
const BUSINESS_ID = "1163381756858080";
const TEST_WABA_ID = "1687411746297834";
const NUMBER_FIELDS = "display_phone_number,verified_name,status,name_status,code_verification_status,quality_rating,platform_type,messaging_limit_tier";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const q = new URL(req.url).searchParams;
  const v = env("WHATSAPP_API_VERSION", "v23.0");
  const g = `https://graph.facebook.com/${v}`;
  const appToken = `${APP_ID}|${env("WHATSAPP_APP_SECRET", "")}`;
  const userToken = env("WHATSAPP_TOKEN", "");
  const wabaId = env("WHATSAPP_WABA_ID", "") || TEST_WABA_ID;
  const phoneId = env("WHATSAPP_PHONE_NUMBER_ID", "");
  const callback = `${env("SUPABASE_URL", "")}/functions/v1/whatsapp`;
  const auth = `access_token=${encodeURIComponent(userToken)}`;
  const out: Record<string, unknown> = { waba_id: wabaId, phone_number_id: phoneId };
  const call = async (label: string, url: string, init?: RequestInit) => {
    try {
      const r = await fetch(url, init);
      const j = await r.json().catch(() => ({}));
      out[label] = { status: r.status, ...(j.error ? { error: j.error.message } : { data: j.data ?? j.success ?? j }) };
    } catch (e) { out[label] = { error: String(e) }; }
  };
  const form = (o: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(o) });

  if (q.get("find")) {
    await call("owned_accounts", `${g}/${BUSINESS_ID}/owned_whatsapp_business_accounts?fields=id,name,phone_numbers{id,${NUMBER_FIELDS}}&${auth}`);
  }
  if (q.get("register")) {
    const pin = env("WHATSAPP_PIN", "");
    if (!/^\d{6}$/.test(pin)) out.register = { error: "Add a 6-digit WHATSAPP_PIN secret first." };
    else if (!phoneId) out.register = { error: "WHATSAPP_PHONE_NUMBER_ID is not set." };
    else await call("register", `${g}/${phoneId}/register`, form({ access_token: userToken, messaging_product: "whatsapp", pin }));
  }
  await call("app_subscription", `${g}/${APP_ID}/subscriptions`, form({
    access_token: appToken, object: "whatsapp_business_account", callback_url: callback,
    verify_token: env("WHATSAPP_VERIFY_TOKEN", ""), fields: "messages", include_values: "true",
  }));
  await call("waba_subscribed_apps", `${g}/${wabaId}/subscribed_apps`, form({ access_token: userToken }));
  await call("check_waba_apps", `${g}/${wabaId}/subscribed_apps?${auth}`);
  await call("phone_numbers", `${g}/${wabaId}/phone_numbers?fields=id,${NUMBER_FIELDS}&${auth}`);
  // Strip anything token-like before returning.
  return json(JSON.parse(JSON.stringify(out).replace(/EAA[A-Za-z0-9]+/g, "[token]")));
});
