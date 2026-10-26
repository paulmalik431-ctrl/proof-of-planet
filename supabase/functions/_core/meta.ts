// Meta Model API client. Runtime-agnostic (Deno edge functions, Bun scripts, tests):
// the key and fetch are passed in, nothing reads the environment here.
// Standard-mode models only — "-contributor" models are refused so people's photos,
// voice notes and messages are never used for training.
import { collectSseText } from "./sam.ts";

export const META_BASE = "https://api.meta.ai/v1";
export const MODELS = {
  spark: "muse-spark-1.3",
  sam: "sam-3.1",
  voice: "muse-voice-transcribe-1.0",
  image: "muse-image-1.0",
} as const;

export class MetaError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export type ChatContent = string | Array<Record<string, unknown>> | null;
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: ChatContent;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

type Fetch = typeof fetch;

export class MetaClient {
  private readonly fetch: Fetch;
  /** Every call is reported here (model, latency, ok) so runs can be audited and costed. */
  onCall?: (e: { model: string; endpoint: string; ms: number; ok: boolean }) => void;

  constructor(private readonly apiKey: string, opts: { fetch?: Fetch; base?: string } = {}) {
    if (!apiKey) throw new MetaError("Meta Model API key missing (MODEL_API_KEY).", 503);
    this.fetch = opts.fetch ?? fetch;
    this.base = opts.base ?? META_BASE;
  }
  private readonly base: string;

  private guard(model: string) {
    if (model.includes("-contributor")) throw new MetaError(`Refusing contributor model ${model}`, 500);
  }

  private async post(endpoint: string, model: string, body: BodyInit, headers: Record<string, string>): Promise<Response> {
    this.guard(model);
    const t0 = Date.now();
    let res: Response | null = null;
    try {
      res = await this.fetch(`${this.base}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, ...headers },
        body,
      });
    } catch {
      res = null;
    }
    this.onCall?.({ model, endpoint, ms: Date.now() - t0, ok: !!res?.ok });
    if (!res) throw new MetaError("Could not reach the Meta Model API.");
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let msg = raw.slice(0, 300);
      try {
        const j = JSON.parse(raw);
        msg = j?.error?.message ?? j?.message ?? msg;
      } catch { /* keep raw */ }
      const hint = { 401: " (check MODEL_API_KEY)", 402: " (billing)", 429: " (rate limited)" }[res.status] ?? "";
      throw new MetaError(`${model} ${endpoint} failed (${res.status})${hint}: ${msg}`, res.status);
    }
    return res;
  }

  /** One chat turn. Returns the assistant message (may contain tool_calls). */
  async chat(opts: {
    messages: ChatMessage[];
    tools?: ToolDef[];
    model?: string;
    responseFormat?: Record<string, unknown>;
    maxTokens?: number;
  }): Promise<{ message: ChatMessage; finish: string }> {
    const model = opts.model ?? MODELS.spark;
    const body: Record<string, unknown> = { model, messages: opts.messages };
    if (opts.tools?.length) body.tools = opts.tools;
    if (opts.responseFormat) body.response_format = opts.responseFormat;
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    const res = await this.post("/chat/completions", model, JSON.stringify(body), { "Content-Type": "application/json" });
    const j = await res.json();
    const choice = j?.choices?.[0];
    if (!choice?.message) throw new MetaError(`${model} returned no message.`);
    return { message: choice.message as ChatMessage, finish: choice.finish_reason ?? "stop" };
  }

  /** Chat with schema-constrained JSON output. */
  async chatJSON<T>(opts: { system: string; user: ChatContent; name: string; schema: Record<string, unknown>; model?: string }): Promise<T> {
    const { message } = await this.chat({
      model: opts.model,
      messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.user }],
      responseFormat: { type: "json_schema", json_schema: { name: opts.name, schema: opts.schema, strict: false } },
    });
    const text = typeof message.content === "string" ? message.content : "";
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      throw new MetaError(`${opts.model ?? MODELS.spark} returned unreadable JSON.`);
    }
  }

  /** SAM 3.1 concept segmentation of one image. Returns raw text (parse with sam.ts). */
  async segment(imageUrl: string, prompt: string): Promise<string> {
    const res = await this.post("/responses", MODELS.sam, JSON.stringify({
      model: MODELS.sam,
      input: [{ type: "message", role: "user", content: [
        { type: "input_text", text: prompt },
        { type: "input_image", image_url: imageUrl },
      ] }],
      stream: true,
      metadata: { include_confidence: "true", mask_encoding: "one_bit" },
    }), { "Content-Type": "application/json", Accept: "text/event-stream" });
    const raw = await res.text();
    if ((res.headers.get("content-type") ?? "").includes("event-stream") || /^(data|event):/m.test(raw.slice(0, 200))) {
      return collectSseText(raw);
    }
    const j = JSON.parse(raw);
    return j.output_text ?? (j.output ?? [])
      .flatMap((o: { content?: Array<{ type: string; text?: string }> }) => o.content ?? [])
      .filter((c: { type: string }) => c.type === "output_text")
      .map((c: { text?: string }) => c.text ?? "")
      .join("");
  }

  /** Muse Voice Transcribe on a WAV clip (≤10 min, ≤32 MB). */
  async transcribe(wav: Uint8Array): Promise<string> {
    const form = new FormData();
    form.append("request", new Blob([JSON.stringify({ model: MODELS.voice, audioEncoding: "WAV", mode: "PUSH_TO_TALK" })], { type: "application/json" }));
    form.append("audio", new Blob([wav as Uint8Array<ArrayBuffer>], { type: "audio/wav" }), "note.wav");
    const res = await this.post("/asr/transcribe", MODELS.voice, form, { Accept: "application/json" });
    const j = await res.json();
    return extractTranscript(j);
  }

  /** Muse Image generation. Returns image bytes (handles b64_json or url responses). */
  async generateImage(prompt: string): Promise<Uint8Array> {
    const res = await this.post("/images/generations", MODELS.image, JSON.stringify({ model: MODELS.image, prompt, n: 1 }), { "Content-Type": "application/json" });
    const j = await res.json();
    const d = j?.data?.[0] ?? {};
    if (d.b64_json) return base64ToBytes(d.b64_json);
    if (d.url) {
      const r = await this.fetch(d.url);
      return new Uint8Array(await r.arrayBuffer());
    }
    throw new MetaError("muse-image returned no image.");
  }
}

/** The transcription response schema isn't fully documented; accept the common shapes. */
export function extractTranscript(j: unknown): string {
  const o = j as Record<string, unknown>;
  if (typeof o?.text === "string") return o.text;
  if (typeof o?.transcript === "string") return o.transcript;
  const parts = (o?.turns ?? o?.segments ?? o?.results) as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(parts)) return parts.map((p) => String(p.transcript ?? p.text ?? "")).filter(Boolean).join(" ");
  return "";
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}
