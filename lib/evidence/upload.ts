/**
 * The evidence upload handler shared by POST /api/v1/evidence (signed in)
 * and POST /api/v1/respond/{token}/evidence (respondent). The route has
 * already done the kill switch, auth or invite lookup, and rate limits.
 *
 * Images live only in this request's memory: they are validated by magic
 * bytes, sent to the vision model, and dropped. Nothing here touches the
 * file system or the database. What leaves is, per image, a status and for
 * readable ones a signed token holding the raw transcript plus a preview of
 * it for the uploader.
 */

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { API_ERROR_STATUS, apiErrorBody, type ApiErrorCode } from "@/lib/api-errors";
import { derivedSecret } from "@/lib/auth";
import {
  EvidenceJsonUpload,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_UPLOAD,
  MAX_UPLOAD_BYTES,
  type EvidenceItemResult,
  type EvidenceUploadResponse,
} from "@/lib/case-types";
import { signEvidenceToken } from "./token";
import { transcribeImage } from "./transcribe";
import type { EvidenceAudience } from "./types";
import { sniffImage } from "./validate";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function fail(code: ApiErrorCode, error: string): NextResponse {
  return NextResponse.json(apiErrorBody(code, error), { status: API_ERROR_STATUS[code], headers: NO_STORE });
}

class TooLarge extends Error {}

/** The body, read as a stream and abandoned past `limit` bytes, so a lying
 * or missing Content-Length cannot make the server buffer more. */
async function readCapped(req: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!req.body) return new Uint8Array(new ArrayBuffer(0));
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new TooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** An image as received: bytes, or a size verdict reached before decoding. */
type Incoming = { bytes: Uint8Array } | { status: "too_large" | "unsupported" };

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** Decodes one JSON image. A `data:` prefix is tolerated; the size is judged
 * from the encoded length before anything is decoded. */
function decodeJsonImage(data: string): Incoming {
  const raw = data.replace(/^data:[^,]{0,100},/, "").replace(/\s+/g, "");
  if (!raw || raw.length % 4 === 1) return { status: "unsupported" };
  if (Math.floor((raw.length * 3) / 4) - 2 > MAX_IMAGE_BYTES) return { status: "too_large" };
  if (BASE64.test(raw)) return { bytes: new Uint8Array(Buffer.from(raw, "base64")) };
  if (BASE64URL.test(raw)) return { bytes: new Uint8Array(Buffer.from(raw, "base64url")) };
  return { status: "unsupported" };
}

type Parsed = { ok: true; images: Incoming[] } | { ok: false; response: NextResponse };

async function parseMultipart(req: Request, contentType: string): Promise<Parsed> {
  const body = await readCapped(req, MAX_UPLOAD_BYTES);
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    return { ok: false, response: fail("invalid", "The upload could not be read.") };
  }
  const files = form.getAll("image").filter((v): v is File => typeof v !== "string");
  if (files.length === 0) return { ok: false, response: fail("invalid", "Add at least one image.") };
  if (files.length > MAX_IMAGES_PER_UPLOAD) {
    return { ok: false, response: fail("too_many_files", `Up to ${MAX_IMAGES_PER_UPLOAD} images at a time.`) };
  }
  const images: Incoming[] = [];
  for (const file of files) {
    images.push(
      file.size > MAX_IMAGE_BYTES ? { status: "too_large" } : { bytes: new Uint8Array(await file.arrayBuffer()) },
    );
  }
  return { ok: true, images };
}

async function parseJson(req: Request): Promise<Parsed> {
  const body = await readCapped(req, MAX_UPLOAD_BYTES);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return { ok: false, response: fail("invalid", "Invalid JSON body") };
  }
  const parsed = EvidenceJsonUpload.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path.length === 1 && issue.path[0] === "images" && issue.code === "too_big") {
      return { ok: false, response: fail("too_many_files", `Up to ${MAX_IMAGES_PER_UPLOAD} images at a time.`) };
    }
    return { ok: false, response: fail("invalid", issue?.message ?? "Invalid request") };
  }
  return { ok: true, images: parsed.data.images.map((i) => decodeJsonImage(i.data)) };
}

const EMPTY: Omit<EvidenceItemResult, "index" | "status"> = { kind: null, token: null, preview: null, expiresAt: null };

async function processImage(index: number, incoming: Incoming, audience: EvidenceAudience): Promise<EvidenceItemResult> {
  if ("status" in incoming) return { index, status: incoming.status, ...EMPTY };
  const sniffed = sniffImage(incoming.bytes);
  if (!sniffed.ok) return { index, status: sniffed.status, ...EMPTY };
  const sha = createHash("sha256").update(incoming.bytes).digest("hex").slice(0, 16);
  const read = await transcribeImage({
    mediaType: sniffed.mediaType,
    data: Buffer.from(incoming.bytes.buffer, incoming.bytes.byteOffset, incoming.bytes.byteLength).toString("base64"),
  });
  if (read.status !== "ok") return { index, status: read.status, ...EMPTY };
  const signed = signEvidenceToken({ audience, kind: read.kind, transcript: read.transcript, sha });
  if (!signed) return { index, status: "failed", ...EMPTY };
  return { index, status: "ok", kind: read.kind, token: signed.token, preview: read.transcript, expiresAt: signed.expiresAt };
}

/**
 * Parses multipart (1-3 parts named "image") or JSON ({ images: [{ data,
 * mediaType? }] }), validates, transcribes in parallel, signs. 200 with one
 * result per image even when some fail; 413 too_large (body over 16 MiB),
 * 400 too_many_files / invalid, 415 unsupported_media (neither multipart
 * nor JSON), 503 not_configured (no signing key).
 */
export async function handleEvidenceUpload(req: Request, audience: EvidenceAudience): Promise<Response> {
  if (!derivedSecret("evidence-token")) {
    return fail("not_configured", "Evidence is not available on this server right now.");
  }
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    return fail("too_large", "That upload is too big.");
  }
  const contentType = req.headers.get("content-type") ?? "";
  const mime = contentType.split(";")[0].trim().toLowerCase();

  let parsed: Parsed;
  try {
    if (mime === "multipart/form-data") parsed = await parseMultipart(req, contentType);
    else if (mime === "application/json") parsed = await parseJson(req);
    else return fail("unsupported_media", "Send images as multipart/form-data or JSON.");
  } catch (e) {
    if (e instanceof TooLarge) return fail("too_large", "That upload is too big.");
    console.error("[evidence] reading the upload failed:", e instanceof Error ? e.message.slice(0, 200) : String(e));
    return fail("invalid", "The upload could not be read.");
  }
  if (!parsed.ok) return parsed.response;

  const items = await Promise.all(parsed.images.map((img, i) => processImage(i, img, audience)));
  const counts = items.reduce<Record<string, number>>((acc, it) => ((acc[it.status] = (acc[it.status] ?? 0) + 1), acc), {});
  console.info(
    `[evidence] upload images=${items.length} ${Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`,
  );
  const body: EvidenceUploadResponse = { items };
  return NextResponse.json(body, { headers: NO_STORE });
}
