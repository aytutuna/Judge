import { judgeCaseHandler } from "@/lib/cases";
import { trialCompat } from "@/lib/trial-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Judging runs after the response (after()), within this budget.
export const maxDuration = 300;

/** POST /api/v1/cases/{id}/judge: judge with only the owner's side, or retry. */
export const POST = trialCompat(async (req: Request, ctx: RouteContext<"/api/v1/cases/[id]/judge">) => {
  const { id } = await ctx.params;
  return judgeCaseHandler(req, id);
});
