import { caseDisplayHandler } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/v1/cases/{id}/display: the owner's display name and the names switch. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/v1/cases/[id]/display">) {
  const { id } = await ctx.params;
  return caseDisplayHandler(req, id);
}
