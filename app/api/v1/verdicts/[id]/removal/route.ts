import { removalHandler } from "@/lib/originals/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/verdicts/{id}/removal: blanks the original and names and closes the link (writer only). */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/verdicts/[id]/removal">) {
  const { id } = await ctx.params;
  return removalHandler(req, id);
}
