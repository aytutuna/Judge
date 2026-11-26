import { NextResponse } from "next/server";
import { z } from "zod";
import type { AgeState } from "@/lib/account-types";
import { confirmAdult, recordMinorSignal, submitDob } from "@/lib/age";
import { validDob } from "@/lib/age-date";
import { apiErrorBody } from "@/lib/api-errors";
import { isSameOrigin, legacyWelcomeClaim, welcomeClaim } from "@/lib/auth";
import { deadBearerResponse, lookupViewer } from "@/lib/bearer-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

// "Under 18" only ever comes from the store's age signal. Without `under13`
// (every shipped build) it makes the account a teen and the date of birth
// still decides for an account without one; only `under13: true` blocks, even
// over a date of 13 or more.
const AgeRequest = z.union([
  z.strictObject({ adult: z.literal(true), source: z.enum(["checkbox", "platform"]) }),
  z.strictObject({ adult: z.literal(false), source: z.literal("platform"), under13: z.boolean().optional() }),
  z.strictObject({ dob: z.string() }),
]);

/** POST /api/v1/me/age records the age check and answers with the account's
 * AgeState:
 * - {dob: "YYYY-MM-DD"}: the date of birth, accepted once (409 age_set after
 *   that; support clears age_dob and age_dob_at to allow a correction). Under
 *   13 closes the account for good. An account blocked under the old 18+
 *   rule may send one date: 13 or more lifts the block.
 * - {adult: true, source: "checkbox" | "platform"}: older builds' tick, or the
 *   store saying 18+. A tick without a date is an adult self-declaration; the
 *   account then reports needsDob.
 * - {adult: false, source: "platform", under13?: boolean}: the store saying
 *   under 18 (a teen whatever date is on file) or, with under13, under 13.
 * A blocked account gets 403 age_blocked here like everywhere else. */
export async function POST(req: Request): Promise<NextResponse> {
  const { viewer, deadBearer, refused } = await lookupViewer(req);
  if (deadBearer) return deadBearerResponse();
  if (refused) return refused;
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
  const parsed = AgeRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      apiErrorBody("invalid", 'Send {"dob": "YYYY-MM-DD"}, {"adult": true, "source": "checkbox" | "platform"} or {"adult": false, "source": "platform", "under13": boolean}.'),
      { status: 400, headers: NO_STORE },
    );
  }
  try {
    const data = parsed.data;
    let age: AgeState | null;
    if ("dob" in data) {
      if (!validDob(data.dob)) return NextResponse.json(apiErrorBody("invalid", "Send a real date as YYYY-MM-DD."), { status: 400, headers: NO_STORE });
      const claims = [welcomeClaim(viewer.user.email), legacyWelcomeClaim(viewer.user.email)].filter((c): c is string => Boolean(c));
      age = await submitDob(viewer.user.id, data.dob, new Date(), claims);
      if (!age) {
        return NextResponse.json(apiErrorBody("age_set", "The date of birth was already given."), { status: 409, headers: NO_STORE });
      }
    } else if (data.adult) {
      age = await confirmAdult(viewer.user.id, data.source);
    } else {
      age = await recordMinorSignal(viewer.user.id, data.under13);
    }
    return NextResponse.json(age, { headers: NO_STORE });
  } catch (e) {
    console.error("[me] age update failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json(apiErrorBody("unavailable", "Your account is unavailable right now."), {
      status: 503,
      headers: NO_STORE,
    });
  }
}
