/** Tiny image headers built in memory for the evidence tests. Only the bytes
 * the sniffer reads are meaningful; the rest is padding. */

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const pad = (n: number) => new Array<number>(n).fill(0);

export function png(width = 640, height = 480): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...be32(13), ...ascii("IHDR"), ...be32(width), ...be32(height),
    8, 6, 0, 0, 0, ...pad(16),
  ]);
}

/** SOI, an APP0 segment, a DHT (C4, must be skipped), then SOF2. */
export function jpeg(width = 1200, height = 1600): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, ...be16(16), ...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc4, ...be16(5), 0, 0, 0,
    0xff, 0xc2, ...be16(17), 8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9,
  ]);
}

export function gif(width = 320, height = 200): Uint8Array {
  return Uint8Array.from([...ascii("GIF89a"), ...le16(width), ...le16(height), 0, 0, 0, ...pad(16)]);
}

export function webpVp8x(width = 1000, height = 700): Uint8Array {
  return Uint8Array.from([
    ...ascii("RIFF"), ...le16(100), 0, 0, ...ascii("WEBP"), ...ascii("VP8X"), ...le16(10), 0, 0,
    0, 0, 0, 0, ...le24(width - 1), ...le24(height - 1), ...pad(8),
  ]);
}

export function webpVp8l(width = 300, height = 150): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return Uint8Array.from([
    ...ascii("RIFF"), ...le16(100), 0, 0, ...ascii("WEBP"), ...ascii("VP8L"), ...le16(10), 0, 0,
    0x2f, w & 0xff, ((w >> 8) & 0x3f) | ((h & 0x03) << 6), (h >> 2) & 0xff, (h >> 10) & 0x0f, ...pad(8),
  ]);
}

export function webpVp8(width = 400, height = 300): Uint8Array {
  return Uint8Array.from([
    ...ascii("RIFF"), ...le16(100), 0, 0, ...ascii("WEBP"), ...ascii("VP8 "), ...le16(10), 0, 0,
    0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height), ...pad(8),
  ]);
}

/** A text file someone renamed to .png. */
export function textFile(): Uint8Array {
  return new TextEncoder().encode("this is not an image, just text\n".repeat(4));
}

/** A valid PNG header padded to `bytes` in total. */
export function bigPng(bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  out.set(png());
  return out;
}

/** The model output for a two-message chat screenshot. */
export const CHAT_TRANSCRIPT = {
  kind: "chat",
  chat_title: "Deniz",
  messages: [
    { side: "sent", speaker: "", time: "21:02", text: "Did you pay the electricity bill?" },
    { side: "received", speaker: "Deniz", time: "21:05", text: "No, it was your turn this month" },
  ],
  other_text: "",
  description: "A messaging app chat screen.",
} as const;
