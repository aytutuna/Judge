import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorBody, type ApiErrorCode } from "@/lib/api-errors";
import { isSameOrigin, reviewAccount } from "@/lib/auth";
import { deadBearerResponse, lookupViewer } from "@/lib/bearer-guard";
import { setPassword } from "@/lib/password";
import { checkUserLimits } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const MIN = 8;
const MAX = 128;

const PasswordRequest = z.strictObject({
  password: z.string().min(MIN).max(MAX),
  current: z.string().max(MAX).optional(),
});

const fail = (code: ApiErrorCode, status: number, message: string, headers: Record<string, string> = {}) =>
  NextResponse.json(apiErrorBody(code, message), { status, headers: { ...NO_STORE, ...headers } });

/** POST /api/v1/me/password {password, current?}: sets the account's password,
 * or replaces it. Replacing needs `current` (password_wrong when it does not
 * match) or a sign-in from the last few minutes; otherwise 403
 * password_required, and the app asks for the current password. The new
 * password is 8 to 128 characters (400 too_short, too_long). Other sessions
 * of the account are signed out; setting the first password signs out none.
 * The review account gets 403 invalid. Answers {ok: true}. */
export async function POST(req: Request): Promise<NextResponse> {
  const { viewer, deadBearer, refused } = await lookupViewer(req);
  if (deadBearer) return deadBearerResponse();
  if (refused) return refused;
  if (!viewer) return fail("signin_required", 401, "Sign in first.");
  if (viewer.via === "cookie" && !isSameOrigin(req)) return fail("bad_origin", 403, "Cross-site request refused.");
  if (reviewAccount()?.email === viewer.user.email.toLowerCase()) return fail("invalid", 403, "A password can't be set on this account.");
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // handled below
  }
  const parsed = PasswordRequest.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "password" && issue.code === "too_small") return fail("too_short", 400, "Password is too short.");
    if (issue?.path[0] === "password" && issue.code === "too_big") return fail("too_long", 400, "Password is too long.");
    return fail("invalid", 400, 'Send {"password": "...", "current": "..."}; current is optional.');
  }
  try {
    const limit = await checkUserLimits(viewer.user.id, "password_set");
    if (!limit.ok) {
      if (limit.code === "unavailable") return fail("unavailable", 503, "Your account is unavailable right now.");
      return fail("rate_limited", 429, "Too many attempts. Try again later.", {
        "Retry-After": String("retryAfterSec" in limit ? limit.retryAfterSec : 60),
      });
    }
    const result = await setPassword(viewer.user.id, viewer.sessionId, parsed.data.password, parsed.data.current);
    if (result === "current_required") return fail("password_required", 403, "Enter your current password.");
    if (result === "current_wrong") return fail("password_wrong", 403, "That password is not right.");
    if (result === "unverified") return fail("invalid", 403, "Sign in with an emailed code first.");
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    console.error("[me] password update failed:", e instanceof Error ? e.message : String(e));
    return fail("unavailable", 503, "Your account is unavailable right now.");
  }
}
