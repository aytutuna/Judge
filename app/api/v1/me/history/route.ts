import { historyHandler } from "@/lib/history/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/me/history?limit=20&cursor=<opaque>: the account's verdicts and cases, newest first. */
export function GET(req: Request) {
  return historyHandler(req);
}
