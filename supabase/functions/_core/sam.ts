// Parser for SAM 3.1 text output (Meta Model API).
// Output is one line per frame: "<0f>0<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..;c=..|><|mask;...|>,1<|box;...|>..."
// Pure TypeScript, no runtime APIs, so it runs in Deno (edge functions) and Bun (tests).

export interface SamBox {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number; // source frame width (px)
  h: number; // source frame height (px)
  c: number | null; // confidence 0..1 when requested with include_confidence
}

export interface SamFrame {
  frame: number;
  boxes: SamBox[];
}

const RECORD = /(\d+)<\|box;([^|]*)\|>(?:<\|mask;[^|]*\|>)?/g;

function parseParams(s: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of s.split(";")) {
    const [k, v] = part.split("=");
    if (k && v !== undefined && v.trim() !== "" && !Number.isNaN(Number(v))) out[k.trim()] = Number(v);
  }
  return out;
}

export function parseSamOutput(text: string): SamFrame[] {
  const frames: SamFrame[] = [];
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^<(\d+)f>(.*)$/.exec(line);
    if (!m) continue;
    const boxes: SamBox[] = [];
    for (const r of m[2].matchAll(RECORD)) {
      const p = parseParams(r[2]);
      if ([p.x1, p.y1, p.x2, p.y2].some((n) => n === undefined)) continue;
      boxes.push({
        id: Number(r[1]),
        x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
        w: p.w ?? 0, h: p.h ?? 0,
        c: p.c === undefined ? null : p.c,
      });
    }
    frames.push({ frame: Number(m[1]), boxes });
  }
  return frames;
}

/** Number of distinct objects found in an image (frame 0), ignoring low-confidence detections. */
export function countObjects(frames: SamFrame[], minConfidence = 0.5): number {
  const f = frames.find((x) => x.frame === 0) ?? frames[0];
  if (!f) return 0;
  return f.boxes.filter((b) => b.c === null || b.c >= minConfidence).length;
}

/** Collect the SAM output_text lane from Responses API SSE deltas and final content-part events. */
export function collectSseText(body: string): string {
  let text = "";
  let completed: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const ev = JSON.parse(payload);
      if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") text += ev.delta;
      if (ev.type === "response.output_text.done" && typeof ev.text === "string") completed = ev.text;
      if (ev.type === "response.content_part.done" && ev.part?.type === "output_text" && typeof ev.part.text === "string") completed = ev.part.text;
    } catch {
      /* ignore keep-alives and partial lines */
    }
  }
  return completed ?? text;
}
