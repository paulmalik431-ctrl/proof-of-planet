import { expect, test } from "bun:test";
import { parseWebhook, sendText, verifySignature, webhookChallenge } from "../supabase/functions/_core/whatsapp.ts";

test("parses text, image, location and audio messages from a Cloud API webhook", () => {
  const payload = { entry: [{ changes: [{ value: { messages: [
    { id: "a", from: "2547", timestamp: "1761500000", type: "text", text: { body: "hi" } },
    { id: "b", from: "2547", timestamp: "1761500001", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg", caption: "my tree" } },
    { id: "c", from: "2547", timestamp: "1761500002", type: "location", location: { latitude: -1.3, longitude: 36.8 } },
    { id: "d", from: "2547", timestamp: "1761500003", type: "audio", audio: { id: "MEDIA2", mime_type: "audio/ogg; codecs=opus" } },
  ] } }] }] };
  const m = parseWebhook(payload);
  expect(m.map((x) => x.type)).toEqual(["text", "image", "location", "audio"]);
  expect(m[1]).toMatchObject({ mediaId: "MEDIA1", caption: "my tree" });
  expect(m[2].location).toEqual({ lat: -1.3, lng: 36.8 });
  expect(parseWebhook({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] })).toEqual([]);
});

test("checks the X-Hub-Signature-256 header", async () => {
  const body = '{"a":1}';
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hex = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  expect(await verifySignature("secret", body, `sha256=${hex}`)).toBe(true);
  expect(await verifySignature("secret", body + " ", `sha256=${hex}`)).toBe(false);
  expect(await verifySignature("secret", body, null)).toBe(false);
  expect(await verifySignature("", body, `sha256=${hex}`)).toBe(false);
});

test("webhook handshake requires a configured, non-empty matching verification token", () => {
  expect(webhookChallenge("subscribe", "verify-me", "challenge-1", "verify-me")).toBe("challenge-1");
  expect(webhookChallenge("subscribe", "", "challenge-1", "")).toBeNull();
  expect(webhookChallenge("subscribe", "wrong", "challenge-1", "verify-me")).toBeNull();
  expect(webhookChallenge("unsubscribe", "verify-me", "challenge-1", "verify-me")).toBeNull();
  expect(webhookChallenge("subscribe", "verify-me", null, "verify-me")).toBeNull();
});

test("outbound WhatsApp refuses missing configuration before making a request", async () => {
  let called = false;
  await expect(sendText({ token: "", phoneNumberId: "", fetch: async () => { called = true; return new Response("ok"); } }, "254712345678", "hello"))
    .rejects.toThrow("WhatsApp messaging is not configured");
  expect(called).toBe(false);
});
