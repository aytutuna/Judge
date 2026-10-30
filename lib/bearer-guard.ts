/**
 * The answer to a bearer token that no longer works (unknown, expired or
 * signed out): 401 `signin_required`, so the app drops the token and signs in
 * again instead of being served as signed out. Requests without an
 * Authorization header (the website, share viewers) are never affected.
 * Also the session lookup routes use, with the age check's answer.
 */

import { NextResponse } from "next/server";
import { ageGateResponse } from "@/lib/age";
import { apiErrorBody } from "@/lib/api-errors";
import { hasDeadBearer, resolveViewer, type ViewerLookup } from "@/lib/auth";
import { signal } from "@/lib/signals";

export function deadBearerResponse(): NextResponse {
  signal("bearer_401");
  return NextResponse.json(apiErrorBody("signin_required", "Sign in first."), {
    status: 401,
    headers: { "Cache-Control": "no-store" },
  });
}

/** resolveViewer plus `refused`: the age check's answer (403 age_blocked or
 * age_unconfirmed, 503 when the lookup failed on a route that needs a
 * confirmed age), which the route sends instead of doing anything. */
export async function lookupViewer(req: Request): Promise<ViewerLookup & { refused: NextResponse | null }> {
  const lookup = await resolveViewer(req);
  return { ...lookup, refused: ageGateResponse(lookup) };
}

/** deadBearerResponse() when the request's bearer token is dead, else null. */
export async function rejectDeadBearer(req: Request): Promise<NextResponse | null> {
  return (await hasDeadBearer(req)) ? deadBearerResponse() : null;
}
