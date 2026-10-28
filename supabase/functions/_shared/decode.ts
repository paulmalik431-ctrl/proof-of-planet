// Deno-side decoder. Unsupported or malformed images fail open for the duplicate check only.
// @ts-ignore npm JPEG package ships no TypeScript declarations.
import jpeg from "npm:jpeg-js@0.4.4";
// @ts-ignore UPNG.js ships no TypeScript declarations.
import UPNG from "npm:upng-js@2.1.0";
import type { ImageDecoder } from "../_core/phash.ts";

function luminance(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

export const decodeImage: ImageDecoder = (bytes, mime) => {
  let rgba: Uint8Array;
  let width: number;
  let height: number;
  if (mime === "image/jpeg" || mime === "image/jpg") {
    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    rgba = decoded.data;
    width = decoded.width;
    height = decoded.height;
  } else if (mime === "image/png") {
    const decoded = UPNG.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const frames = UPNG.toRGBA8(decoded);
    if (!frames.length) return null;
    rgba = new Uint8Array(frames[0]);
    width = decoded.width;
    height = decoded.height;
  } else return null;
  if (rgba.length !== width * height * 4) return null;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    gray[p] = luminance(rgba[i], rgba[i + 1], rgba[i + 2]);
  }
  return { gray, width, height };
};

