import { createCaseHandler, listCasesHandler } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Reserve, anonymize side A (up to 120s with its one retry) and store, with headroom.
export const maxDuration = 150;

/** POST /api/v1/cases: start a two-sided case (Premium). */
export function POST(req: Request) {
  return createCaseHandler(req);
}

/** GET /api/v1/cases: the signed-in owner's cases, newest first. */
export function GET(req: Request) {
  return listCasesHandler(req);
}
