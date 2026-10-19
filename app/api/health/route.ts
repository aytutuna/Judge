import { NextResponse } from "next/server";

// Answer per request, never from a build-time prerender.
export const dynamic = "force-dynamic";

/**
 * Liveness check for deploy scripts and uptime monitors: answers once the
 * server is up. Touches no model, database or secret, and is not rate
 * limited (only POST /api/verdict is).
 */
export function GET(): NextResponse {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
