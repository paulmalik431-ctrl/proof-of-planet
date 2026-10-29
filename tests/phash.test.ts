import { expect, test } from "bun:test";
import jpeg from "jpeg-js";
import { dHash, hamming, safeDHash } from "../supabase/functions/_core/phash.ts";
import { decodeImage } from "./decode-image.ts";

function photo(width: number, height: number, kind: "landscape" | "unrelated" = "landscape") {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    let v: number;
    if (kind === "landscape") {
      v = 118 + 40 * Math.sin(x / 45) + 27 * Math.cos(y / 40) + 15 * Math.sin((x + y) / 60);
      if ((x > 24 && x < 78 && y > 40 && y < 90) || (x > 88 && y > 20 && y < 58)) v -= 32;
    } else {
      v = ((Math.floor(x / 7) + Math.floor(y / 9)) % 2) ? 220 : 25;
      if (x > width / 2) v = 255 - v;
    }
    data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, Math.round(v)));
    data[i + 3] = 255;
  }
  return data;
}

function encode(data: Uint8Array, width: number, height: number, quality: number) {
  return new Uint8Array(jpeg.encode({ data: Buffer.from(data), width, height }, quality).data);
}

function cropResize(rgba: Uint8Array, width: number, height: number) {
  const crop = Math.round(width * 0.9);
  const startX = Math.floor((width - crop) / 2), startY = Math.floor((height - crop) / 2);
  const outSize = Math.round(crop * 0.6);
  const out = new Uint8Array(outSize * outSize * 4);
  for (let y = 0; y < outSize; y++) for (let x = 0; x < outSize; x++) {
    const sx = startX + Math.min(crop - 1, Math.floor((x + 0.5) * crop / outSize));
    const sy = startY + Math.min(crop - 1, Math.floor((y + 0.5) * crop / outSize));
    const from = (sy * width + sx) * 4, to = (y * outSize + x) * 4;
    out.set(rgba.subarray(from, from + 4), to);
  }
  return { data: out, width: outSize, height: outSize };
}

test("64-bit dHash validates input and Hamming distance", () => {
  const gray = Uint8Array.from({ length: 64 * 64 }, (_, i) => i % 64 < 32 ? 0 : 255);
  const hash = dHash(gray, 64, 64);
  expect(hash).toMatch(/^[0-9a-f]{16}$/);
  expect(hamming(hash, hash)).toBe(0);
  expect(hamming("0000000000000000", "000000000000000f")).toBe(4);
  expect(() => dHash(new Uint8Array(2), 3, 3)).toThrow("Invalid grayscale image");
});

test("JPEG near duplicates remain close after crop, resize and recompression", () => {
  const width = 128, height = 128;
  const base = encode(photo(width, height), width, height, 90);
  const baseImage = decodeImage(base, "image/jpeg")!;
  const baseHash = dHash(baseImage.gray, baseImage.width, baseImage.height);

  const decoded = jpeg.decode(base, { useTArray: true, formatAsRGBA: true });
  const transformed = cropResize(decoded.data, decoded.width, decoded.height);
  const copy = encode(transformed.data, transformed.width, transformed.height, 40);
  const copyImage = decodeImage(copy, "image/jpeg")!;
  const copyHash = dHash(copyImage.gray, copyImage.width, copyImage.height);
  const unrelated = encode(photo(width, height, "unrelated"), width, height, 90);
  const otherImage = decodeImage(unrelated, "image/jpeg")!;
  const otherHash = dHash(otherImage.gray, otherImage.width, otherImage.height);

  expect(hamming(baseHash, copyHash)).toBeLessThanOrEqual(6);
  expect(hamming(baseHash, otherHash)).toBeGreaterThan(20);
});

test("unsupported or broken images skip only the perceptual check", () => {
  expect(safeDHash(undefined, new Uint8Array([1]), "image/jpeg")).toBeNull();
  expect(safeDHash(decodeImage, new Uint8Array([1, 2]), "image/jpeg")).toBeNull();
  expect(safeDHash(decodeImage, new Uint8Array([1]), "image/webp")).toBeNull();
});

