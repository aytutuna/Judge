import { deleteCaseHandler, getCaseHandler } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/cases/{id}: the owner's view of a case. */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/cases/[id]">) {
  const { id } = await ctx.params;
  return getCaseHandler(req, id);
}

/** DELETE /api/v1/cases/{id}: kept for older clients; removes the owner's
 * side (original, names, display name) and closes the case's links. No row
 * is deleted. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/v1/cases/[id]">) {
  const { id } = await ctx.params;
  return deleteCaseHandler(req, id);
}
