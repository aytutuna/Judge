import { respondDisplayHandler } from "@/lib/cases";
import { trialCompat } from "@/lib/trial-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/v1/respond/{token}/display: Party B's display name. */
export const PATCH = trialCompat(async (req: Request, ctx: RouteContext<"/api/v1/respond/[token]/display">) => {
  const { token } = await ctx.params;
  return respondDisplayHandler(req, token);
});
