// One-time WhatsApp wiring, run server-side with the secrets already stored in Supabase (nobody sees them):
// 1) subscribe this app's webhook to the WhatsApp Business Account "messages" field;
// 2) subscribe the WhatsApp Business Account to this app so its messages are delivered here.
// Idempotent and harmless to re-run: it only (re)subscribes our own app to our own account. Reports status, never secrets.
import { cors, env, json } from "../_shared/deps.ts";

const APP_ID = "1137729232072325";
const WABA_ID = "1687411746297834";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const v = env("WHATSAPP_API_VERSION", "v23.0");
  const g = `https://graph.facebook.com/${v}`;
  const appToken = `${APP_ID}|${env("WHATSAPP_APP_SECRET", "")}`;
  const userToken = env("WHATSAPP_TOKEN", "");
  const callback = `${env("SUPABASE_URL", "")}/functions/v1/whatsapp`;
  const out: Record<string, unknown> = {};
  const call = async (label: string, url: string, init?: RequestInit) => {
    try {
      const r = await fetch(url, init);
      const j = await r.json().catch(() => ({}));
      out[label] = { status: r.status, ...(j.error ? { error: j.error.message } : { data: j.data ?? j.success ?? j }) };
    } catch (e) { out[label] = { error: String(e) }; }
  };
  const form = (o: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(o) });
  await call("app_subscription", `${g}/${APP_ID}/subscriptions`, form({
    access_token: appToken, object: "whatsapp_business_account", callback_url: callback,
    verify_token: env("WHATSAPP_VERIFY_TOKEN", ""), fields: "messages", include_values: "true",
  }));
  await call("waba_subscribed_apps", `${g}/${WABA_ID}/subscribed_apps`, form({ access_token: userToken }));
  await call("check_app_subscriptions", `${g}/${APP_ID}/subscriptions?access_token=${encodeURIComponent(appToken)}`);
  await call("check_waba_apps", `${g}/${WABA_ID}/subscribed_apps?access_token=${encodeURIComponent(userToken)}`);
  // Strip anything token-like before returning.
  return json(JSON.parse(JSON.stringify(out).replace(/EAA[A-Za-z0-9]+/g, "[token]")));
});
