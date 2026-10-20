import { displayHandler } from "@/lib/originals/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/v1/verdicts/{id}/display: display names and the names switch (writer only). */
export async function PATCH(req: Request, ctx: RouteContext<"/api/v1/verdicts/[id]/display">) {
  const { id } = await ctx.params;
  return displayHandler(req, id);
}
