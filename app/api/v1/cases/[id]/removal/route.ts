import { caseRemovalHandler } from "@/lib/cases";
import { trialCompat } from "@/lib/trial-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/cases/{id}/removal: removes the owner's side and closes the case's links. */
export const POST = trialCompat(async (req: Request, ctx: RouteContext<"/api/v1/cases/[id]/removal">) => {
  const { id } = await ctx.params;
  return caseRemovalHandler(req, id);
});
