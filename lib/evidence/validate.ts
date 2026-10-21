/**
 * Image validation by magic bytes. The declared media type (file name,
 * multipart Content-Type, JSON mediaType) is never trusted: the signature
 * decides what an upload is and which media type the model is told.
 */

import { MAX_IMAGE_BYTES } from "@/lib/case-types";

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** The API rejects larger images; screenshots are far below it. */
export const MAX_IMAGE_EDGE = 8000;

export type SniffResult =
  | { ok: true; mediaType: ImageMediaType; width: number; height: number }
  | { ok: false; status: "unsupported" | "too_large" };

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);

function ascii(b: Uint8Array, start: number, text: string): boolean {
  if (b.length < start + text.length) return false;
  for (let i = 0; i < text.length; i++) if (b[start + i] !== text.charCodeAt(i)) return false;
  return true;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngSize(b: Uint8Array): [number, number] | null {
  if (b.length < 24 || !ascii(b, 12, "IHDR")) return null;
  return [u32be(b, 16), u32be(b, 20)];
}

/** Walks the JPEG markers up to the first start-of-frame (SOF0..SOF15, but
 * not DHT C4, JPG C8 or DAC CC, which share the range). */
function jpegSize(b: Uint8Array): [number, number] | null {
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    let marker = b[i + 1];
    // Fill bytes: any number of 0xFF before the marker.
    while (marker === 0xff && i + 2 < b.length) {
      i += 1;
      marker = b[i + 1];
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    // End of image or start of scan before any frame header: no size.
    if (marker === 0xd9 || marker === 0xda) return null;
    if (i + 3 >= b.length) return null;
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 8 >= b.length) return null;
      return [u16be(b, i + 7), u16be(b, i + 5)];
    }
    i += 2 + length;
  }
  return null;
}

function gifSize(b: Uint8Array): [number, number] | null {
  return b.length >= 10 ? [u16le(b, 6), u16le(b, 8)] : null;
}

function webpSize(b: Uint8Array): [number, number] | null {
  if (b.length < 30) return null;
  if (ascii(b, 12, "VP8 ")) {
    // Key frame start code, then 14-bit width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return [u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff];
  }
  if (ascii(b, 12, "VP8L")) {
    if (b[20] !== 0x2f) return null;
    const width = 1 + (b[21] | ((b[22] & 0x3f) << 8));
    const height = 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10));
    return [width, height];
  }
  if (ascii(b, 12, "VP8X")) return [1 + u24le(b, 24), 1 + u24le(b, 27)];
  return null;
}

/**
 * What an upload really is. Order: size cap, signature, dimensions. An
 * unknown signature or unparseable header is "unsupported"; too many bytes
 * or pixels is "too_large". Pure; never copies or keeps the bytes.
 */
export function sniffImage(bytes: Uint8Array): SniffResult {
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, status: "too_large" };
  let mediaType: ImageMediaType;
  let size: [number, number] | null;
  if (bytes.length >= 8 && PNG_SIGNATURE.every((v, i) => bytes[i] === v)) {
    mediaType = "image/png";
    size = pngSize(bytes);
  } else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    mediaType = "image/jpeg";
    size = jpegSize(bytes);
  } else if (ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a")) {
    mediaType = "image/gif";
    size = gifSize(bytes);
  } else if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) {
    mediaType = "image/webp";
    size = webpSize(bytes);
  } else {
    return { ok: false, status: "unsupported" };
  }
  if (!size || size[0] < 1 || size[1] < 1) return { ok: false, status: "unsupported" };
  if (size[0] > MAX_IMAGE_EDGE || size[1] > MAX_IMAGE_EDGE) return { ok: false, status: "too_large" };
  return { ok: true, mediaType, width: size[0], height: size[1] };
}
