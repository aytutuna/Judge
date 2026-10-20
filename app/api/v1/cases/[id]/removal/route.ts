import { caseRemovalHandler } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/cases/{id}/removal: removes the owner's side and closes the case's links. */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/cases/[id]/removal">) {
  const { id } = await ctx.params;
  return caseRemovalHandler(req, id);
}
