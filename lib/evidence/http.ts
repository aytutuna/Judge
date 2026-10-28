/**
 * POST /api/v1/evidence for signed-in Premium users. Gate order: kill switch,
 * session, same-origin (cookie sessions), Premium usable (no unit is spent),
 * per-user limit; then the shared upload handler.
 */

import { NextResponse } from "next/server";
import { API_ERROR_STATUS, apiErrorBody, type ApiErrorBody, type ApiErrorCode } from "@/lib/api-errors";
import { getViewer, isSameOrigin } from "@/lib/auth";
import { getEntitlement, hasWelcomeCreditOnly } from "@/lib/entitlements";
import { evidenceEnabled } from "@/lib/features";
import { checkUserLimits } from "@/lib/ratelimit";
import { handleEvidenceUpload } from "./upload";

const BLOCK_MESSAGES = {
  premium_required: "Evidence needs Premium credits or a monthly plan.",
  no_credits: "You have no premium credits left.",
  fair_use: "You have used this month's premium verdicts.",
} as const;

function fail(code: ApiErrorCode, error: string, extra: Omit<ApiErrorBody, "code" | "error"> = {}): NextResponse {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (extra.retryAfterSec !== undefined) headers["Retry-After"] = String(extra.retryAfterSec);
  return NextResponse.json(apiErrorBody(code, error, extra), { status: API_ERROR_STATUS[code], headers });
}

const unavailable = () => fail("unavailable", "Evidence is unavailable right now — try again in a minute.");

export async function evidenceUploadRoute(req: Request): Promise<Response> {
  if (!evidenceEnabled()) return fail("not_configured", "Evidence is not available on this server right now.");

  const viewer = await getViewer(req);
  if (!viewer) return fail("signin_required", "Sign in to add evidence.");
  if (viewer.via === "cookie" && !isSameOrigin(req)) return fail("bad_origin", "This request came from another site.");
  const userId = viewer.user.id;

  let welcome: boolean;
  try {
    const entitlement = await getEntitlement(userId);
    if (!entitlement.canUsePremium) {
      const code = entitlement.blockedReason ?? "premium_required";
      return fail(code, BLOCK_MESSAGES[code], entitlement.resetsAt && code === "fair_use" ? { resetsAt: entitlement.resetsAt } : {});
    }
    welcome = await hasWelcomeCreditOnly(userId);
  } catch (e) {
    console.error("[evidence] entitlement read failed:", e instanceof Error ? e.message : String(e));
    return unavailable();
  }

  const limit = await checkUserLimits(userId, welcome ? "welcome_evidence" : "evidence");
  if (!limit.ok) {
    if (limit.code === "unavailable") return unavailable();
    return fail("rate_limited", "Too many uploads from your account — try again later.", {
      retryAfterSec: limit.retryAfterSec,
    });
  }

  return handleEvidenceUpload(req, { type: "user", userId });
}
