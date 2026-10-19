import { clarifyHandler } from "@/lib/premium/handler";

export const runtime = "nodejs";
// One clarify call (CLARIFY_TIMEOUT_MS, 20s) plus the session and limit
// checks, with headroom. A literal: Next reads it statically.
export const maxDuration = 30;

/** POST /api/v1/clarify: up to two clarifying questions before a premium
 * verdict. */
export async function POST(req: Request) {
  return clarifyHandler(req);
}
