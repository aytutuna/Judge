import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureEntitlementTables } from "@/lib/entitlements";

// Answer per request, never from a build-time prerender.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Liveness check for uptime monitors: answers once the server is up and
 * touches no model, database or secret. Not rate limited (only POST
 * /api/verdict is). With `?ready=1` (the deploy scripts) it also runs a
 * query through the database client, runs the entitlement migrations and answers 503 when that fails, so a
 * release with a broken database or migration is rolled back. It is a query
 * parameter so that an older release, which ignores it, still passes the
 * check when update.sh rolls back to it.
 */
export async function GET(req: Request): Promise<NextResponse> {
  if (new URL(req.url).searchParams.get("ready") !== "1") {
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }
  try {
    await (await getDb()).execute("SELECT 1");
    await ensureEntitlementTables();
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    console.error("[health] database check failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
}
