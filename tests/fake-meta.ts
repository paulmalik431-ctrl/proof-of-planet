// A scripted stand-in for the Meta Model API, so tests run offline and cost nothing.
import { MetaClient, type ToolCall } from "../supabase/functions/_core/meta.ts";

export type Turn = { text: string } | { tools: Array<[string, Record<string, unknown>]> };

export interface Script {
  /** SAM detections per noun phrase (number of boxes returned). */
  sam: Record<string, number>;
  /** Muse Spark observation returned for Witness verification calls. */
  observation: Record<string, unknown>;
  /** JSON returned for other schema-constrained calls, by schema name (e.g. lot_observation, mediation). */
  json?: Record<string, Record<string, unknown>>;
  /** Agent turns, consumed in order: either text or tool calls. */
  agent: Array<Turn | (() => Turn)>;
}

export function fakeMeta(script: Script) {
  const log: Array<{ endpoint: string; body: any }> = [];
  let callId = 0;
  const f = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    log.push({ endpoint: u.replace(/^https:\/\/api\.meta\.ai\/v1/, ""), body });
    if (u.endsWith("/responses")) {
      const phrase = body.input[0].content[0].text as string;
      const n = script.sam[phrase] ?? 0;
      const boxes = Array.from({ length: n }, (_, i) => `${i}<|box;x1=${10 + i};y1=10;x2=${50 + i};y2=90;w=100;h=100;c=0.9|>`).join(",");
      const sse = `data: ${JSON.stringify({ type: "response.output_text.delta", delta: n ? `<0f>${boxes}` : "" })}\n\ndata: [DONE]\n`;
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }
    if (u.endsWith("/chat/completions")) {
      if (body.response_format) {
        const name = body.response_format.json_schema?.name as string;
        const out = script.json?.[name] ?? script.observation;
        return Response.json({ choices: [{ message: { role: "assistant", content: JSON.stringify(out) }, finish_reason: "stop" }] });
      }
      const queued = script.agent.shift() ?? { text: "ok" };
      const next = typeof queued === "function" ? queued() : queued;
      if ("text" in next) return Response.json({ choices: [{ message: { role: "assistant", content: next.text }, finish_reason: "stop" }] });
      const tool_calls: ToolCall[] = next.tools.map(([name, args]) => ({ id: `call_${++callId}`, type: "function", function: { name, arguments: JSON.stringify(args) } }));
      return Response.json({ choices: [{ message: { role: "assistant", content: null, tool_calls }, finish_reason: "tool_calls" }] });
    }
    return new Response("not found", { status: 404 });
  };
  return { meta: new MetaClient("test-key", { fetch: f as typeof fetch }), log };
}

export const YES_TREE = {
  answers: { young_tree_in_ground: "yes", recently_planted: "yes", potted_or_indoor: "no" },
  possibly_ai_generated_or_edited: false, confidence: 0.9, notes: "A sapling in fresh soil.", better_evidence: "",
};

export const png = (seed: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed, seed + 1, seed + 2]);
