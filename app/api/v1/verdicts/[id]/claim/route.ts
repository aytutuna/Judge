import { claimHandler } from "@/lib/originals/http";
import { trialCompat } from "@/lib/trial-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/verdicts/{id}/claim: keeps a token-owned verdict in the signed-in account. */
export const POST = trialCompat(async (req: Request, ctx: RouteContext<"/api/v1/verdicts/[id]/claim">) => {
  const { id } = await ctx.params;
  return claimHandler(req, id);
});
