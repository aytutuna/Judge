import { mineHandler } from "@/lib/originals/http";
import { trialCompat } from "@/lib/trial-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/verdicts/{id}/mine: the writer's own view (session or X-Owner-Token). */
export const GET = trialCompat(async (req: Request, ctx: RouteContext<"/api/v1/verdicts/[id]/mine">) => {
  const { id } = await ctx.params;
  return mineHandler(req, id);
});
