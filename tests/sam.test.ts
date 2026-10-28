import { describe, expect, test } from "bun:test";
import { collectSseText, countObjects, parseSamOutput } from "../supabase/functions/_core/sam.ts";

const DOC_EXAMPLE =
  "<0f>0<|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561|><|mask;x=0;y=0;data=46,101,~abc|>,1<|box;x1=260;y1=382;x2=340;y2=427;w=537;h=561|><|mask;x=0;y=0;data=46,81,~def|>";

describe("SAM 3.1 output parser", () => {
  test("parses the documented two-object example", () => {
    const frames = parseSamOutput(DOC_EXAMPLE);
    expect(frames).toHaveLength(1);
    expect(frames[0].frame).toBe(0);
    expect(frames[0].boxes).toHaveLength(2);
    expect(frames[0].boxes[0]).toEqual({ id: 0, x1: 353, y1: 382, x2: 453, y2: 427, w: 537, h: 561, c: null });
    expect(countObjects(frames)).toBe(2);
  });
  test("reads confidence and drops low-confidence detections", () => {
    const t = "<0f>0<|box;x1=1;y1=2;x2=3;y2=4;w=10;h=10;c=0.92|><|mask;x=0;y=0;data=2,2,!z|>,4<|box;x1=5;y1=5;x2=6;y2=6;w=10;h=10;c=0.31|><|mask;x=0;y=0;data=2,2,!z|>";
    const f = parseSamOutput(t);
    expect(f[0].boxes.map((b) => b.id)).toEqual([0, 4]);
    expect(f[0].boxes[0].c).toBeCloseTo(0.92);
    expect(countObjects(f)).toBe(1);
  });
  test("no matches is an empty result, not an error", () => {
    expect(parseSamOutput("")).toEqual([]);
    expect(countObjects(parseSamOutput(""))).toBe(0);
    expect(countObjects(parseSamOutput("<0f>"))).toBe(0);
  });
  test("multi-frame video output keeps frames apart", () => {
    const t = "<0f>0<|box;x1=1;y1=1;x2=2;y2=2;w=9;h=9|>\n<1f>0<|box;x1=1;y1=1;x2=2;y2=2;w=9;h=9|>,2<|box;x1=3;y1=3;x2=4;y2=4;w=9;h=9|>";
    const f = parseSamOutput(t);
    expect(f.map((x) => x.boxes.length)).toEqual([1, 2]);
    expect(countObjects(f)).toBe(1);
  });
  test("collects text from a server-sent-event stream", () => {
    const sse = [
      'data: {"type":"response.output_text.delta","delta":"<0f>0<|box;x1=1;"}',
      'data: {"type":"response.output_text.delta","delta":"y1=1;x2=2;y2=2;w=9;h=9|>"}',
      "data: [DONE]",
    ].join("\n");
    expect(collectSseText(sse)).toBe("<0f>0<|box;x1=1;y1=1;x2=2;y2=2;w=9;h=9|>");
  });
});

test("collects SAM text from Meta's finalized content_part.done event", () => {
  const samText = "<0f>0<|box;x1=10;y1=20;x2=14;y2=24;w=100;h=80;c=0.91|><|mask;x=0;y=0;data=2,2,!abcd|>";
  const body = [
    "event: response.created",
    'data: {"type":"response.created","response":{"id":"resp_live_shape"}}',
    "",
    "event: response.content_part.done",
    `data: ${JSON.stringify({ type: "response.content_part.done", item_id: "msg_0", output_index: 0, content_index: 0, part: { type: "output_text", text: samText } })}`,
    "",
    "event: response.completed",
    'data: {"type":"response.completed","response":{"status":"completed","output":[]}}',
    "",
    "data: [DONE]",
  ].join("\n");
  const text = collectSseText(body);
  expect(text).toBe(samText);
  expect(countObjects(parseSamOutput(text))).toBe(1);
});