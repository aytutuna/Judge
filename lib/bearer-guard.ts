/**
 * The answer to a bearer token that no longer works (unknown, expired or
 * signed out): 401 `signin_required`, so the app drops the token and signs in
 * again instead of being served as signed out. Requests without an
 * Authorization header (the website, share viewers) are never affected.
 */

import { NextResponse } from "next/server";
import { apiErrorBody } from "@/lib/api-errors";
import { hasDeadBearer } from "@/lib/auth";

export function deadBearerResponse(): NextResponse {
  return NextResponse.json(apiErrorBody("signin_required", "Sign in first."), {
    status: 401,
    headers: { "Cache-Control": "no-store" },
  });
}

/** deadBearerResponse() when the request's bearer token is dead, else null. */
export async function rejectDeadBearer(req: Request): Promise<NextResponse | null> {
  return (await hasDeadBearer(req)) ? deadBearerResponse() : null;
}
