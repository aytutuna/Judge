import { ACCEPTED_IMAGE_TYPES, IMAGE_LONG_EDGE, MAX_IMAGE_BYTES } from "./case-types";

/**
 * Client-side image preparation for evidence uploads. A phone screenshot is
 * downscaled to IMAGE_LONG_EDGE on its longest side and re-encoded as JPEG,
 * which also drops EXIF data such as GPS position. Small PNG and GIF images
 * are sent as they are: text stays crisp and they carry no camera metadata.
 * The server still validates every byte (magic numbers, size, dimensions);
 * this only keeps uploads small and fast on mobile networks.
 *
 * The pure helpers (fitWithin, keepOriginal) are unit-tested; prepareImage
 * needs a browser (createImageBitmap or <img>, and a canvas).
 */

export const JPEG_QUALITY = 0.85;

/** Size that fits inside `max` on its longest side, keeping the aspect ratio. */
export function fitWithin(
  width: number,
  height: number,
  max: number = IMAGE_LONG_EDGE,
): { width: number; height: number; scaled: boolean } {
  const long = Math.max(width, height);
  if (!(long > max)) return { width, height, scaled: false };
  const ratio = max / long;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  };
}

/** Whether the original file can be uploaded untouched. */
export function keepOriginal(type: string, width: number, height: number, bytes: number): boolean {
  return (
    (type === "image/png" || type === "image/gif") &&
    !fitWithin(width, height).scaled &&
    bytes <= MAX_IMAGE_BYTES
  );
}

/** A type the server accepts (the server decides by magic bytes anyway). */
export function isAcceptedType(type: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type);
}

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall through to <img>, which some browsers decode more formats with.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY));
}

/**
 * The file to upload, or null when the browser cannot decode it at all (it
 * is then reported as unsupported without an upload). Formats a browser can
 * decode but the server does not accept (such as HEIC on Safari) come out
 * as JPEG.
 */
export async function prepareImage(file: File): Promise<Blob | null> {
  let decoded: Decoded;
  try {
    decoded = await decode(file);
  } catch {
    return null;
  }
  try {
    const { width, height, source } = decoded;
    if (!width || !height) return null;
    if (keepOriginal(file.type, width, height, file.size)) return file;
    const size = fitWithin(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return isAcceptedType(file.type) ? file : null;
    // JPEG has no alpha: transparent screenshots get a white page, not black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, size.width, size.height);
    return (await toJpeg(canvas)) ?? (isAcceptedType(file.type) ? file : null);
  } finally {
    decoded.close();
  }
}
