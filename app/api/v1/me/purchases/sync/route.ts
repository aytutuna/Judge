import { NextResponse } from "next/server";
import { apiErrorBody, type ApiErrorCode } from "@/lib/api-errors";
import { isSameOrigin } from "@/lib/auth";
import { deadBearerResponse, lookupViewer } from "@/lib/bearer-guard";
import { getEntitlement } from "@/lib/entitlements";
import { checkUserLimits } from "@/lib/ratelimit";
import { revenueCatApiKey, syncRevenueCat } from "@/lib/revenuecat-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const fail = (code: ApiErrorCode, status: number, message: string, headers: Record<string, string> = {}) =>
  NextResponse.json(apiErrorBody(code, message), { status, headers: { ...NO_STORE, ...headers } });

/** POST /api/v1/me/purchases/sync: Restore. The apps call it after
 * `Purchases.restorePurchases()` and show the `entitlement` it returns. It
 * asks RevenueCat for the account's store subscriptions and applies the
 * active ones at once; `synced` is how many plans were added. 503
 * not_configured without REVENUECAT_API_KEY, 503 unavailable when RevenueCat
 * cannot be reached, 429 past 10 calls in 10 minutes. */
export async function POST(req: Request): Promise<NextResponse> {
  const { viewer, deadBearer, refused } = await lookupViewer(req);
  if (deadBearer) return deadBearerResponse();
  if (refused) return refused;
  if (!viewer) return fail("signin_required", 401, "Sign in first.");
  if (viewer.via === "cookie" && !isSameOrigin(req)) return fail("bad_origin", 403, "Cross-site request refused.");
  const key = revenueCatApiKey();
  if (!key) return fail("not_configured", 503, "Restoring purchases is not set up on this server.");

  const limit = await checkUserLimits(viewer.user.id, "purchase_sync");
  if (!limit.ok) {
    if (limit.code === "unavailable") return fail("unavailable", 503, "Try again in a minute.");
    return NextResponse.json(apiErrorBody("rate_limited", "Too many restores — try again later.", { retryAfterSec: limit.retryAfterSec }), {
      status: 429,
      headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSec) },
    });
  }

  try {
    const synced = await syncRevenueCat(viewer.user.id, key);
    return NextResponse.json({ synced, entitlement: await getEntitlement(viewer.user.id) }, { headers: NO_STORE });
  } catch (e) {
    console.error("[purchases] restore sync failed:", e instanceof Error ? e.message : String(e));
    return fail("unavailable", 503, "Could not check your purchases right now. Try again.");
  }
}
