import { NextResponse } from "next/server";
import { z } from "zod";
import type { AgeState } from "@/lib/account-types";
import { blockMinor, confirmAdult } from "@/lib/age";
import { apiErrorBody } from "@/lib/api-errors";
import { isSameOrigin } from "@/lib/auth";
import { deadBearerResponse, lookupViewer } from "@/lib/bearer-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

// The website only has the checkbox; "under 18" only ever comes from the
// store's age signal.
const AgeRequest = z.union([
  z.strictObject({ adult: z.literal(true), source: z.enum(["checkbox", "platform"]) }),
  z.strictObject({ adult: z.literal(false), source: z.literal("platform") }),
]);

/** POST /api/v1/me/age {adult: true, source: "checkbox" | "platform"} or
 * {adult: false, source: "platform"}: records the age check and answers with
 * the account's AgeState. A block is permanent: a blocked account gets 403
 * age_blocked here like everywhere else. */
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
      apiErrorBody("invalid", 'Send {"adult": true, "source": "checkbox" | "platform"} or {"adult": false, "source": "platform"}.'),
      { status: 400, headers: NO_STORE },
    );
  }
  try {
    const age: AgeState = parsed.data.adult
      ? await confirmAdult(viewer.user.id, parsed.data.source)
      : await blockMinor(viewer.user.id);
    return NextResponse.json(age, { headers: NO_STORE });
  } catch (e) {
    console.error("[me] age update failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json(apiErrorBody("unavailable", "Your account is unavailable right now."), {
      status: 503,
      headers: NO_STORE,
    });
  }
}
