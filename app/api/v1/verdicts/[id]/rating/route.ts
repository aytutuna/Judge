import { ratingPutHandler } from "@/lib/feedback/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT /api/v1/verdicts/{id}/rating: set, change or clear the viewer's "Fair verdict?" rating. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return ratingPutHandler(req, id);
}
