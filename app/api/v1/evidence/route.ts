import { evidenceUploadRoute } from "@/lib/evidence/http";

export const runtime = "nodejs";
// Up to three vision calls in parallel (45s each) plus reading the upload.
// A literal: Next reads it statically.
export const maxDuration = 90;

/** POST /api/v1/evidence: transcribe up to three screenshots (multipart
 * "image" parts or JSON base64) and return a signed token per readable image.
 * Images are processed in memory and never stored. */
export async function POST(req: Request) {
  return evidenceUploadRoute(req);
}
