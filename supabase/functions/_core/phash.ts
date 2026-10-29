export interface GrayImage {
  gray: Uint8Array;
  width: number;
  height: number;
}

/** 64-bit difference hash from an area-averaged 9×8 grayscale image. */
export function dHash(gray: Uint8Array, width: number, height: number): string {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || gray.length !== width * height) {
    throw new Error("Invalid grayscale image dimensions");
  }
  const small = new Float64Array(9 * 8);
  for (let ty = 0; ty < 8; ty++) {
    const top = ty * height / 8;
    const bottom = (ty + 1) * height / 8;
    for (let tx = 0; tx < 9; tx++) {
      const left = tx * width / 9;
      const right = (tx + 1) * width / 9;
      let sum = 0;
      let area = 0;
      for (let y = Math.floor(top); y < Math.ceil(bottom); y++) {
        if (y < 0 || y >= height) continue;
        const oy = Math.max(0, Math.min(bottom, y + 1) - Math.max(top, y));
        for (let x = Math.floor(left); x < Math.ceil(right); x++) {
          if (x < 0 || x >= width) continue;
          const ox = Math.max(0, Math.min(right, x + 1) - Math.max(left, x));
          const weight = ox * oy;
          sum += gray[y * width + x] * weight;
          area += weight;
        }
      }
      small[ty * 9 + tx] = area ? sum / area : 0;
    }
  }
  let out = "";
  for (let nibble = 0; nibble < 16; nibble++) {
    let value = 0;
    for (let bit = 0; bit < 4; bit++) {
      const index = nibble * 4 + bit;
      const y = Math.floor(index / 8);
      const x = index % 8;
      if (small[y * 9 + x] > small[y * 9 + x + 1]) value |= 1 << (3 - bit);
    }
    out += value.toString(16);
  }
  return out;
}

/** Number of differing bits between two 64-bit hexadecimal hashes. */
export function hamming(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/i.test(a) || !/^[0-9a-f]{16}$/i.test(b)) throw new Error("Expected 64-bit hexadecimal hashes");
  let bits = BigInt("0x" + a) ^ BigInt("0x" + b);
  let count = 0;
  while (bits) {
    bits &= bits - 1n;
    count++;
  }
  return count;
}

export type ImageDecoder = (bytes: Uint8Array, mime: string) => GrayImage | null;

export function safeDHash(decodeImage: ImageDecoder | undefined, bytes: Uint8Array, mime: string): string | null {
  if (!decodeImage) return null;
  try {
    const image = decodeImage(bytes, mime);
    return image ? dHash(image.gray, image.width, image.height) : null;
  } catch {
    return null;
  }
}

