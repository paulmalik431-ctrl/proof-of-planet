// WhatsApp Cloud API webhook → ECO agent → replies.
// GET  = Meta's webhook verification handshake.
// POST = inbound messages. Signature-checked, acknowledged at once, processed in the background.
import { handle } from "../_core/agent.ts";
import { markRead, parseWebhook, sendText, toInbound, verifySignature, type WaConfig } from "../_core/whatsapp.ts";
import { env, makeDeps } from "../_shared/deps.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const wa: WaConfig = {
  token: env("WHATSAPP_TOKEN", ""),
  phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID", ""),
  version: env("WHATSAPP_API_VERSION", "v23.0"),
};

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === env("WHATSAPP_VERIFY_TOKEN", "");
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "") : new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const raw = await req.text();
  if (!(await verifySignature(env("WHATSAPP_APP_SECRET", ""), raw, req.headers.get("x-hub-signature-256")))) {
    return new Response("bad signature", { status: 401 });
  }
  const messages = parseWebhook(JSON.parse(raw));
  const work = (async () => {
    const deps = makeDeps({ messagesPerDay: Number(env("MESSAGES_PER_DAY", "60")), verificationsPerDay: Number(env("VERIFICATIONS_PER_DAY", "8")) });
    for (const m of messages) {
      try {
        await markRead(wa, m.id);
        const replies = await handle(deps, await toInbound(wa, m));
        for (const r of replies) await sendText(wa, m.from, r);
      } catch (e) {
        console.error("whatsapp message failed", m.id, String(e));
        await sendText(wa, m.from, "Sorry, something went wrong on our side. Please try again in a minute.").catch(() => undefined);
      }
    }
  })();
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
  else await work;
  return new Response("ok");
});
