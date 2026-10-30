import { cachedMetricsText, isLocalRequest } from "@/lib/analytics/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/internal/metrics: usage aggregates for Alloy on this server.
 * 404 for anything but a direct request from the machine itself; Caddy also
 * answers 404 for /api/internal/* before it reaches the app. */
export async function GET(req: Request): Promise<Response> {
  if (!isLocalRequest(req.headers)) return new Response("Not found\n", { status: 404 });
  try {
    return new Response(await cachedMetricsText(), {
      headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("[metrics] computing usage metrics failed:", e instanceof Error ? e.message : String(e));
    return new Response("unavailable\n", { status: 503 });
  }
}
