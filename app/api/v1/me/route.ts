import { NextResponse } from "next/server";
import type { MeResponse } from "@/lib/account-types";
import { apiErrorBody } from "@/lib/api-errors";
import { clearSessionCookieHeaders, deleteAuthUser, getViewer, isSameOrigin } from "@/lib/auth";
import { deleteUserEntitlements, getEntitlement } from "@/lib/entitlements";
import { removeUserData } from "@/lib/originals/removal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** GET /api/v1/me: the viewer and their entitlement; nulls when signed out
 * (200, so one call drives every UI state). */
export async function GET(req: Request): Promise<NextResponse> {
  const viewer = await getViewer(req);
  if (!viewer) {
    const body: MeResponse = { user: null, entitlement: null };
    return NextResponse.json(body, { headers: NO_STORE });
  }
  try {
    const body: MeResponse = { user: viewer.user, entitlement: await getEntitlement(viewer.user.id) };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (e) {
    console.error("[me] entitlement lookup failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json(apiErrorBody("unavailable", "Your account is unavailable right now."), {
      status: 503,
      headers: NO_STORE,
    });
  }
}

/** DELETE /api/v1/me { confirm: "delete" }: removes every verdict the
 * account owns and its side of every case (originals, name maps and display
 * names blanked, share links closed; no verdict row is deleted), then
 * deletes its entitlements, sign-ins and sessions. */
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
  try {
    await removeUserData(viewer.user.id);
    await deleteUserEntitlements(viewer.user.id);
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
