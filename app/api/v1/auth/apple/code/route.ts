import { NextResponse } from "next/server";
import { apiErrorBody, type ApiErrorCode } from "@/lib/api-errors";
import { isSameOrigin, resolveViewer } from "@/lib/auth";
import { deadBearerResponse } from "@/lib/bearer-guard";
import { isAppleAuthorizationCode, keepNativeAppleToken, type NativeAppleResult } from "@/lib/signin-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function fail(code: ApiErrorCode, error: string, status: number): NextResponse {
  return NextResponse.json(apiErrorBody(code, error), { status, headers: NO_STORE });
}

const FAILURES: Record<Exclude<NativeAppleResult, { ok: true }>["reason"], [ApiErrorCode, string, number]> = {
  not_configured: ["not_configured", "Sign in with Apple is not set up on this server.", 503],
  no_apple_account: ["invalid", "This account has no Sign in with Apple.", 400],
  invalid_code: ["invalid", "Apple did not accept this authorization code.", 400],
  mismatch: ["invalid", "This authorization code belongs to another Apple ID.", 400],
  no_key: ["unavailable", "The token cannot be stored right now.", 503],
  unavailable: ["unavailable", "Apple is unavailable right now. Try again.", 503],
};

/**
 * POST /api/v1/auth/apple/code { code }: the iOS app sends the
 * `authorizationCode` from a native Sign in with Apple right after it has
 * signed in with the identity token (bearer session). The server exchanges it
 * with Apple (client id APPLE_APP_BUNDLE_ID) and keeps the refresh token,
 * sealed, only to revoke it when the account is deleted. Codes are single-use
 * and expire after a few minutes. 200 { stored: true } on success.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const { viewer, deadBearer } = await resolveViewer(req);
  if (deadBearer) return deadBearerResponse();
  if (!viewer) return fail("signin_required", "Sign in first.", 401);
  if (viewer.via === "cookie" && !isSameOrigin(req)) return fail("bad_origin", "Cross-site request refused.", 403);

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // handled below
  }
  const code = typeof body === "object" && body !== null ? (body as { code?: unknown }).code : undefined;
  if (!isAppleAuthorizationCode(code)) return fail("invalid", 'Send { "code": "<Apple authorization code>" }.', 400);

  let result: NativeAppleResult;
  try {
    result = await keepNativeAppleToken(viewer.user.id, code);
  } catch (e) {
    console.error("[apple-code] storing the Apple token failed:", e instanceof Error ? e.message : String(e));
    result = { ok: false, reason: "unavailable" };
  }
  if (result.ok) return NextResponse.json({ stored: true }, { headers: NO_STORE });
  const [errorCode, message, status] = FAILURES[result.reason];
  return fail(errorCode, message, status);
}
