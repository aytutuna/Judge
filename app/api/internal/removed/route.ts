import { removedHtml } from "@/lib/removed-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/internal/removed?state=removed|unavailable: the page a removed
 * verdict's link answers with (410, or 503 when the check failed). On Workers
 * there is no proxy.ts, so cloudflare/worker.ts does the check in front of
 * /v/<id> and asks for this page. It holds nothing about any verdict. */
export async function GET(req: Request): Promise<Response> {
  const state = new URL(req.url).searchParams.get("state") === "unavailable" ? "unavailable" : "removed";
  return removedHtml(req, state);
}
