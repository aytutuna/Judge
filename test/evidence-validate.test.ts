import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES } from "../lib/case-types";
import { sniffImage } from "../lib/evidence/validate";
import { bigPng, gif, jpeg, png, textFile, webpVp8, webpVp8l, webpVp8x } from "./evidence-fixtures";

describe("sniffImage (magic bytes)", () => {
  it.each([
    ["PNG", png(640, 480), "image/png", 640, 480],
    ["JPEG (SOF2 after APP0 and DHT)", jpeg(1200, 1600), "image/jpeg", 1200, 1600],
    ["GIF", gif(320, 200), "image/gif", 320, 200],
    ["WebP VP8X", webpVp8x(1000, 700), "image/webp", 1000, 700],
    ["WebP VP8L", webpVp8l(300, 150), "image/webp", 300, 150],
    ["WebP VP8", webpVp8(400, 300), "image/webp", 400, 300],
  ])("reads %s", (_name, bytes, mediaType, width, height) => {
    expect(sniffImage(bytes)).toEqual({ ok: true, mediaType, width, height });
  });

  it("calls a renamed text file unsupported", () => {
    expect(sniffImage(textFile())).toEqual({ ok: false, status: "unsupported" });
  });

  it("calls an empty or truncated header unsupported", () => {
    expect(sniffImage(new Uint8Array(0))).toEqual({ ok: false, status: "unsupported" });
    expect(sniffImage(png().slice(0, 12))).toEqual({ ok: false, status: "unsupported" });
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toEqual({ ok: false, status: "unsupported" });
    expect(sniffImage(png(0, 10))).toEqual({ ok: false, status: "unsupported" });
  });

  it("calls a file over 5 MiB too large, whatever it is", () => {
    expect(sniffImage(bigPng(6 * 1024 * 1024))).toEqual({ ok: false, status: "too_large" });
    expect(sniffImage(bigPng(MAX_IMAGE_BYTES))).toMatchObject({ ok: true });
  });

  it("calls an image over 8000 px on a side too large", () => {
    expect(sniffImage(png(8001, 100))).toEqual({ ok: false, status: "too_large" });
    expect(sniffImage(jpeg(100, 9000))).toEqual({ ok: false, status: "too_large" });
    expect(sniffImage(png(8000, 8000))).toMatchObject({ ok: true });
  });

  it("ignores what the file claims to be: only the signature decides", () => {
    // A GIF signature with PNG-looking padding is a GIF.
    expect(sniffImage(gif())).toMatchObject({ mediaType: "image/gif" });
  });
});
