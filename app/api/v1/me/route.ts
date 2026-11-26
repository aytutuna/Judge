import { NextResponse } from "next/server";
import type { MeResponse } from "@/lib/account-types";
import { keepBlock } from "@/lib/age";
import { forgetUser } from "@/lib/analytics/db";
import { apiErrorBody } from "@/lib/api-errors";
import {
  authProviders,
  clearSessionCookieHeaders,
  deleteAuthUser,
  getViewer,
  isSameOrigin,
  resolveViewer,
  retryWelcomeCredit,
  reviewAccount,
  welcomeClaim,
} from "@/lib/auth";
import { deadBearerResponse } from "@/lib/bearer-guard";
import { deleteUserEntitlements, getEntitlement } from "@/lib/entitlements";
import { removeUserData } from "@/lib/originals/removal";
import { hasPassword, reauthForDelete } from "@/lib/password";
import { checkUserLimits } from "@/lib/ratelimit";
import { revokeSignInTokens } from "@/lib/signin-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** GET /api/v1/me: the viewer, their entitlement and age check; nulls when
 * signed out (200, so one call drives every UI state). A bearer token that no longer
 * works answers 401 signin_required. */
export async function GET(req: Request): Promise<NextResponse> {
  const { viewer, deadBearer } = await resolveViewer(req);
  if (deadBearer) return deadBearerResponse();
  if (!viewer) {
    const body: MeResponse = { user: null, entitlement: null, age: null };
    return NextResponse.json(body, { headers: NO_STORE });
  }
  try {
    let entitlement = await getEntitlement(viewer.user.id);
    if (entitlement.credits === 0 && !entitlement.subscription && (await missedWelcome(viewer.user.id))) {
      entitlement = await getEntitlement(viewer.user.id);
    }
    const password = await hasPassword(viewer.user.id);
    const body: MeResponse = {
      user: viewer.user,
      entitlement,
      age: viewer.age,
      hasPassword: password,
      // The store review account signs in with its fixed code and never gets a password.
      needsPassword:
        authProviders(req).password && !password && reviewAccount()?.email !== viewer.user.email.toLowerCase(),
    };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (e) {
    console.error("[me] entitlement lookup failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json(apiErrorBody("unavailable", "Your account is unavailable right now."), {
      status: 503,
      headers: NO_STORE,
    });
  }
}

async function missedWelcome(userId: string): Promise<boolean> {
  try {
    return await retryWelcomeCredit(userId);
  } catch (e) {
    console.error("[me] welcome credit retry failed:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** DELETE /api/v1/me { confirm: "delete", password? }: needs a sign-in from
 * the last 10 minutes, or the account's password (403 reauth_required, or
 * password_wrong), and counts against 5 tries per 10 minutes (429). Revokes
 * the account's stored Sign in with Apple tokens at Apple (a failure there is logged and recorded,
 * and does not stop the deletion), removes every verdict the account owns and
 * its side of every case (originals, name maps and display names blanked,
 * share links closed; no verdict row is deleted), then deletes its
 * entitlements, usage events, sign-ins, stored tokens and sessions and
 * unlinks its devices. A blocked account's block is kept with the
 * scrambled email, so signing up again with it starts blocked. */
export async function DELETE(req: Request): Promise<NextResponse> {
  const viewer = await getViewer(req);
  if (!viewer) {
    return NextResponse.json(apiErrorBody("signin_required", "Sign in first."), { status: 401, headers: NO_STORE });
  }
  if (viewer.via === "cookie" && !isSameOrigin(req)) {
    return NextResponse.json(apiErrorBody("bad_origin", "Cross-site request refused."), {
      status: 403,
      headers: NO_STORE,
    });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // handled below
  }
  if (typeof body !== "object" || body === null || (body as { confirm?: unknown }).confirm !== "delete") {
    return NextResponse.json(apiErrorBody("invalid", 'Send { "confirm": "delete" } to delete the account.'), {
      status: 400,
      headers: NO_STORE,
    });
  }
  const password = (body as { password?: unknown }).password;
  if (password !== undefined && (typeof password !== "string" || password.length > 128)) {
    return NextResponse.json(apiErrorBody("invalid", "Send the password as a string."), {
      status: 400,
      headers: NO_STORE,
    });
  }
  try {
    const limit = await checkUserLimits(viewer.user.id, "account_delete");
    if (!limit.ok) {
      if (limit.code === "unavailable") {
        return NextResponse.json(apiErrorBody("unavailable", "Your account is unavailable right now."), {
          status: 503,
          headers: NO_STORE,
        });
      }
      return NextResponse.json(apiErrorBody("rate_limited", "Too many attempts. Try again later."), {
        status: 429,
        headers: { ...NO_STORE, "Retry-After": String("retryAfterSec" in limit ? limit.retryAfterSec : 60) },
      });
    }
    const reauth = await reauthForDelete(viewer.user.id, viewer.sessionId, password);
    if (reauth !== "ok") {
      const message = reauth === "password_wrong" ? "That password is not right." : "Sign in again to delete the account.";
      return NextResponse.json(apiErrorBody(reauth, message), { status: 403, headers: NO_STORE });
    }
    // TODO: cancel a Stripe plan here once web payments exist; store plans are cancelled by the person.
    const claim = viewer.age.blocked ? welcomeClaim(viewer.user.email) : null;
    if (claim) await keepBlock(claim, !viewer.age.needsDob);
    const signInTokens = await revokeSignInTokens(viewer.user.id);
    await removeUserData(viewer.user.id, new Date(), { signInTokens });
    await deleteUserEntitlements(viewer.user.id);
    await forgetUser(viewer.user.id);
    await deleteAuthUser(viewer.user.id);
  } catch (e) {
    console.error("[me] account deletion failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json(apiErrorBody("unavailable", "Deleting the account failed. Try again."), {
      status: 503,
      headers: NO_STORE,
    });
  }
  const res = NextResponse.json({ deleted: true }, { headers: NO_STORE });
  for (const cookie of await clearSessionCookieHeaders()) res.headers.append("Set-Cookie", cookie);
  return res;
}
