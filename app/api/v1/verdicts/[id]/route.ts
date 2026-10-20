import { NextResponse } from "next/server";
import { apiErrorBody } from "@/lib/api-errors";
import { getPublicVerdict } from "@/lib/originals/display";
import type { StoredVerdictResponse } from "@/lib/types";

export const runtime = "nodejs";

/** Share ids are nanoid(10); anything that could not be one is a 404
 * without a database read (same rule as the translate route). */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function notFound(): NextResponse {
  return NextResponse.json(apiErrorBody("not_found", "No verdict with that id."), { status: 404 });
}

/**
 * GET /api/v1/verdicts/{id}: a stored verdict, public like a share link,
 * with the display names the share page shows (null = the labels). The
 * stored input text is never returned. A removed verdict answers 410.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/verdicts/[id]">) {
  const { id } = await ctx.params;
  if (!ID_PATTERN.test(id)) return notFound();
  let found;
  try {
    found = await getPublicVerdict(id);
  } catch (e) {
    console.error("[verdicts] read failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json(
      apiErrorBody("unavailable", "Verdicts are unavailable right now — try again in a minute."),
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!found) return notFound();
  if (found.removed) {
    return NextResponse.json(apiErrorBody("removed", "This verdict was removed. Its link no longer works."), {
      status: 410,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const { stored, display } = found;
  const body: StoredVerdictResponse = { id: stored.id, result: stored.result, createdAt: stored.createdAt, display };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
