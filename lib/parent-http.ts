/**
 * The teen's side of the parent step over HTTP (app/api/v1/me/parent):
 * reading where it stands, giving or changing the parent's address, and
 * sending it again. Server only.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorBody, API_ERROR_STATUS, type ApiErrorCode } from "@/lib/api-errors";
import { isSameOrigin } from "@/lib/auth";
import { deadBearerResponse, lookupViewer } from "@/lib/bearer-guard";
import { clientIp } from "@/lib/client-ip";
import { langFromRequest } from "@/lib/email";
import { ensureParentRow, healApprovals, parentView, requestParent, sendBlocked } from "@/lib/parent-consent";
import { checkIpLimits, checkUserLimits } from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function fail(code: ApiErrorCode, message: string, retryAfterSec?: number): NextResponse {
  return NextResponse.json(apiErrorBody(code, message, retryAfterSec ? { retryAfterSec } : {}), {
    status: API_ERROR_STATUS[code],
    headers: retryAfterSec ? { ...NO_STORE, "Retry-After": String(retryAfterSec) } : NO_STORE,
  });
}

const SetBody = z.strictObject({ email: z.string().trim().max(254).pipe(z.email()), turnstileToken: z.string().optional() });
const ResendBody = z.strictObject({ turnstileToken: z.string().optional() });

function refusal(code: "parent_declined" | "parent_wait" | "parent_limit", retryAfterSec?: number): NextResponse {
  if (code === "parent_declined") return fail(code, "The parent declined.");
  if (code === "parent_wait") return fail(code, "Wait before sending it again.", retryAfterSec);
  return fail(code, "No more sends or changes are left.");
}

/** GET /api/v1/me/parent: ParentView, the state of the request. */
export async function parentGet(req: Request): Promise<NextResponse> {
  const { viewer, deadBearer, refused } = await lookupViewer(req);
  if (deadBearer) return deadBearerResponse();
  if (refused) return refused;
  if (!viewer) return fail("signin_required", "Sign in first.");
  try {
    // A teen who has to ask a parent gets the row (and its 30 days) here at the latest.
    if (viewer.age.parent) await ensureParentRow(viewer.user.id);
    await healApprovals(new Date(), viewer.user.id);
    return NextResponse.json(await parentView(viewer.user.id), { headers: NO_STORE });
  } catch (e) {
    console.error("[parent] read failed:", e instanceof Error ? e.message : String(e));
    return fail("unavailable", "Your account is unavailable right now.");
  }
}

/** POST /api/v1/me/parent {email, turnstileToken?} sets or changes the
 * parent's address and mails the request; POST /api/v1/me/parent/resend {}
 * mails the current address again. Answers ParentView. Errors: 400
 * parent_email, 409 parent_declined, parent_limit, parent_conflict, 429
 * parent_wait (retryAfterSec) and rate_limited, 403 captcha_failed (web). */
export async function parentPost(req: Request, mode: "set" | "resend"): Promise<NextResponse> {
  const { viewer, deadBearer, refused } = await lookupViewer(req);
  if (deadBearer) return deadBearerResponse();
  if (refused) return refused;
  if (!viewer) return fail("signin_required", "Sign in first.");
  if (viewer.via === "cookie" && !isSameOrigin(req)) return fail("bad_origin", "Cross-site request refused.");
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // handled below
  }
  const parsed = (mode === "set" ? SetBody : ResendBody).safeParse(body ?? {});
  if (!parsed.success) {
    return fail(mode === "set" ? "parent_email" : "invalid", mode === "set" ? "Send {\"email\": \"parent@example.com\"}." : "Send {}.");
  }
  if (!viewer.age.parent) return fail("parent_conflict", "This account does not need a parent.");
  const ip = clientIp(req.headers);
  try {
    // A send that would be refused anyway costs no bot check and no quota.
    const blocked = await sendBlocked(viewer.user.id, mode === "set" ? (parsed.data as z.infer<typeof SetBody>).email : null);
    if (blocked) return refusal(blocked.code, blocked.retryAfterSec);
    if (viewer.via !== "bearer") {
      const captcha = await verifyTurnstile(parsed.data.turnstileToken, ip);
      if (captcha === "invalid") return fail("captcha_failed", "Bot check failed. Reload the page and try again.");
      if (captcha === "error") return fail("unavailable", "Your account is unavailable right now.");
    }
    for (const limit of [await checkIpLimits(ip, "parent_request"), await checkUserLimits(viewer.user.id, "parent_request")]) {
      if (limit.ok) continue;
      if (limit.code === "unavailable") return fail("unavailable", "Your account is unavailable right now.");
      return fail("rate_limited", "Too many requests. Try again later.", "retryAfterSec" in limit ? limit.retryAfterSec : undefined);
    }
    const result = await requestParent({
      userId: viewer.user.id,
      userName: viewer.user.name,
      userEmail: viewer.user.email,
      email: mode === "set" ? (parsed.data as z.infer<typeof SetBody>).email : null,
      lang: langFromRequest(req),
    });
    if (result.ok) return NextResponse.json(result.view, { headers: NO_STORE });
    switch (result.code) {
      case "parent_email":
        return fail("parent_email", "Use a parent's own email address.");
      case "parent_declined":
      case "parent_wait":
      case "parent_limit":
        return refusal(result.code, result.retryAfterSec);
      case "rate_limited":
        return fail("rate_limited", "Too many requests. Try again later.", result.retryAfterSec);
      case "unavailable":
        return fail("unavailable", "Your account is unavailable right now.");
      default:
        return fail("parent_conflict", "That changed just now. Try again.");
    }
  } catch (e) {
    console.error("[parent] request failed:", e instanceof Error ? e.message : String(e));
    return fail("unavailable", "Your account is unavailable right now.");
  }
}
