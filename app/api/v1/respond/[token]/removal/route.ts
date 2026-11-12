import { respondRemovalHandler } from "@/lib/cases";
import { trialCompat } from "@/lib/trial-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/respond/{token}/removal: removes Party B's side and closes the case's links. */
export const POST = trialCompat(async (req: Request, ctx: RouteContext<"/api/v1/respond/[token]/removal">) => {
  const { token } = await ctx.params;
  return respondRemovalHandler(req, token);
});
