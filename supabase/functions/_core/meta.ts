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
  sparkOpen: "meta-models/muse-spark-open-1026", // Meta open-weight model, served by Baseten for the hackathon
} as const;

export const BASETEN_BASE = "https://inference.baseten.co/v1";

/** Where chat (agent + vision reasoning) runs. Default: Muse Spark 1.3 on Meta Model API. */
export interface ChatProvider { base: string; key: string; model: string; label: string }

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

/** Safe receipt metadata for a model API call; never includes prompt, image, or credentials. */
export interface ModelCallTrace {
  model: string;
  endpoint: string;
  ms: number;
  ok: boolean;
}

export class MetaClient {
  private readonly fetch: Fetch;
  /** Every call is reported here (model, latency, ok) so runs can be audited and costed. */
  onCall?: (e: ModelCallTrace) => void;

  /** Chat provider in use; SAM 3.1, voice and image always use the Meta Model API. */
  readonly chatProvider: ChatProvider;

  constructor(private readonly apiKey: string | null, opts: { fetch?: Fetch; base?: string; chat?: ChatProvider } = {}) {
    if (!apiKey && !opts.chat) throw new MetaError("No model key: set MODEL_API_KEY (Meta Model API) or BASETEN_API_KEY (Muse Spark Open).", 503);
    this.fetch = opts.fetch ?? fetch;
    this.base = opts.base ?? META_BASE;
    this.chatProvider = opts.chat ?? { base: this.base, key: apiKey!, model: MODELS.spark, label: "Muse Spark 1.3 (Meta Model API)" };
  }
  private readonly base: string;

  /** SAM 3.1 needs the Meta Model API; without it, Witness and Loop fall back to the reasoning model's count estimate. */
  get canSegment(): boolean { return !!this.apiKey; }

  private guard(model: string) {
    if (model.includes("-contributor")) throw new MetaError(`Refusing contributor model ${model}`, 500);
  }

  private async post(endpoint: string, model: string, body: BodyInit, headers: Record<string, string>, via?: ChatProvider): Promise<Response> {
    this.guard(model);
    if (!via && !this.apiKey) throw new MetaError(`${model} needs the Meta Model API key (MODEL_API_KEY).`, 503);
    const t0 = Date.now();
    let res: Response | null = null;
    try {
      res = await this.fetch(`${via?.base ?? this.base}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${via?.key ?? this.apiKey}`, ...headers },
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
    const via = this.chatProvider;
    const model = via.base === this.base ? (opts.model ?? via.model) : via.model;
    const body: Record<string, unknown> = { model, messages: opts.messages };
    if (opts.tools?.length) body.tools = opts.tools;
    if (opts.responseFormat) body.response_format = opts.responseFormat;
    // Reasoning models spend tokens thinking first; leave room for the answer.
    // Muse Spark 1.3 and Spark Open both reason first (live: 598 of 600 tokens went to reasoning, content empty).
    if (opts.maxTokens) body.max_tokens = Math.max(opts.maxTokens, 4000);
    const res = await this.post("/chat/completions", model, JSON.stringify(body), { "Content-Type": "application/json" }, via);
    const j = await res.json();
    const choice = j?.choices?.[0];
    if (!choice?.message) throw new MetaError(`${model} returned no message.`);
    const message = choice.message as ChatMessage;
    // Some responses carry content as parts ([{type:"text",text}]) rather than a string.
    const raw = message.content as unknown;
    if (Array.isArray(raw)) message.content = raw.map((p) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : "")).join("");
    if (typeof message.content === "string") message.content = stripReasoning(message.content);
    if (!message.content && !message.tool_calls?.length) {
      console.log("chat_empty", JSON.stringify({ model, finish: choice.finish_reason, keys: Object.keys(choice.message), usage: j?.usage, sample: JSON.stringify(choice.message).slice(0, 400) }));
    }
    return { message, finish: choice.finish_reason ?? "stop" };
  }

  /** The model that actually answered chat calls, for audit records. */
  get reasoningModel(): string { return this.chatProvider.model; }

  /** Chat with schema-constrained JSON output. */
  async chatJSON<T>(opts: { system: string; user: ChatContent; name: string; schema: Record<string, unknown>; model?: string }): Promise<T> {
    const messages: ChatMessage[] = [{ role: "system", content: opts.system }, { role: "user", content: opts.user }];
    let message: ChatMessage;
    try {
      ({ message } = await this.chat({ model: opts.model, messages, responseFormat: { type: "json_schema", json_schema: { name: opts.name, schema: opts.schema, strict: false } } }));
    } catch (e) {
      // Providers without structured output: ask for the same JSON in plain text.
      if (!(e instanceof MetaError) || e.status !== 400) throw e;
      ({ message } = await this.chat({ model: opts.model, messages: [{ role: "system", content: `${opts.system}\n\nReply with ONLY a JSON object matching this JSON Schema, no prose:\n${JSON.stringify(opts.schema)}` }, messages[1]] }));
    }
    const text = typeof message.content === "string" ? message.content : "";
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    const cleaned = start >= 0 && end > start ? text.slice(start, end + 1) : text;
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      throw new MetaError(`${this.chatProvider.model} returned unreadable JSON.`);
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
      const text = collectSseText(raw);
      if (!text) console.log("sam_sse_empty", JSON.stringify({ prompt, content_type: res.headers.get("content-type"), raw: raw.slice(0, 1500) }));
      return text;
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

/** Removes visible chain-of-thought some reasoning models put in the content. */
export function stripReasoning(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
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

/**
 * Builds the client from settings. Meta Model API (MODEL_API_KEY) gives SAM 3.1, voice and image;
 * chat runs on Muse Spark 1.3 there, or on Meta's open-weight Muse Spark Open via Baseten
 * (BASETEN_API_KEY) when CHAT_PROVIDER=baseten or when no Meta key is set.
 */
export function clientFromEnv(get: (k: string) => string | undefined, fetchImpl?: typeof fetch): MetaClient {
  const metaKey = get("MODEL_API_KEY") || null;
  const bt = get("BASETEN_API_KEY");
  const useBaseten = !!bt && (get("CHAT_PROVIDER") === "baseten" || !metaKey);
  return new MetaClient(metaKey, {
    fetch: fetchImpl,
    chat: useBaseten ? { base: BASETEN_BASE, key: bt!, model: MODELS.sparkOpen, label: "Muse Spark Open (open weights, Baseten)" } : undefined,
  });
}
