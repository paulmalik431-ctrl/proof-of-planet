// WhatsApp Cloud API (Meta): webhook parsing, signature check, media download, replies.
// Runtime-agnostic: fetch + WebCrypto only.
import type { Inbound } from "./agent.ts";

export interface WaConfig {
  token: string;          // WHATSAPP_TOKEN (system user or temporary token)
  phoneNumberId: string;  // WHATSAPP_PHONE_NUMBER_ID
  version?: string;       // Graph API version
  fetch?: typeof fetch;
}

const graph = (c: WaConfig) => `https://graph.facebook.com/${c.version ?? "v23.0"}`;

/** Raw inbound message reference (media not yet downloaded). */
export interface WaMessage {
  id: string;
  from: string;
  at: Date;
  type: string;
  text?: string;
  mediaId?: string;
  mime?: string;
  caption?: string;
  location?: { lat: number; lng: number };
}

// deno-lint-ignore no-explicit-any
export function parseWebhook(payload: any): WaMessage[] {
  const out: WaMessage[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const m of change?.value?.messages ?? []) {
        const base = { id: String(m.id), from: String(m.from), at: new Date(Number(m.timestamp) * 1000 || Date.now()), type: String(m.type) };
        if (m.type === "text") out.push({ ...base, text: m.text?.body ?? "" });
        else if (m.type === "image") out.push({ ...base, mediaId: m.image?.id, mime: m.image?.mime_type, caption: m.image?.caption });
        else if (m.type === "audio") out.push({ ...base, mediaId: m.audio?.id, mime: m.audio?.mime_type });
        else if (m.type === "location") out.push({ ...base, location: { lat: Number(m.location?.latitude), lng: Number(m.location?.longitude) } });
        else if (m.type === "interactive") out.push({ ...base, type: "text", text: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "" });
        else if (m.type === "button") out.push({ ...base, type: "text", text: m.button?.text ?? "" });
        else out.push(base);
      }
    }
  }
  return out;
}

export async function verifySignature(appSecret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7);
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

export async function downloadMedia(c: WaConfig, mediaId: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const f = c.fetch ?? fetch;
  const meta = await f(`${graph(c)}/${mediaId}`, { headers: { Authorization: `Bearer ${c.token}` } });
  if (!meta.ok) throw new Error(`media lookup failed (${meta.status})`);
  const { url, mime_type } = await meta.json();
  const bin = await f(url, { headers: { Authorization: `Bearer ${c.token}` } });
  if (!bin.ok) throw new Error(`media download failed (${bin.status})`);
  return { bytes: new Uint8Array(await bin.arrayBuffer()), mime: mime_type ?? "application/octet-stream" };
}

export async function toInbound(c: WaConfig, m: WaMessage): Promise<Inbound> {
  const base = { id: m.id, from: m.from, at: m.at };
  if (m.type === "text") return { ...base, kind: "text", text: m.text };
  if (m.type === "location" && m.location) return { ...base, kind: "location", location: m.location };
  if (m.type === "image" && m.mediaId) return { ...base, kind: "image", image: { ...(await downloadMedia(c, m.mediaId)), caption: m.caption } };
  if (m.type === "audio" && m.mediaId) return { ...base, kind: "audio", audio: await downloadMedia(c, m.mediaId) };
  return { ...base, kind: "other" };
}

export async function sendText(c: WaConfig, to: string, body: string): Promise<void> {
  const f = c.fetch ?? fetch;
  const res = await f(`${graph(c)}/${c.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: body.slice(0, 4096), preview_url: true } }),
  });
  if (!res.ok) throw new Error(`send failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

/** Blue ticks, so the person knows ECO is working on it. */
export async function markRead(c: WaConfig, messageId: string): Promise<void> {
  const f = c.fetch ?? fetch;
  await f(`${graph(c)}/${c.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
  }).catch(() => undefined);
}
