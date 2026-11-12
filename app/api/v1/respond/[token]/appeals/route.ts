import { respondAppealHandler } from "@/lib/cases";
import { trialCompat } from "@/lib/trial-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/v1/respond/{token}/appeals: a signed-in Premium respondent adds context. */
export const POST = trialCompat(async (req: Request, ctx: RouteContext<"/api/v1/respond/[token]/appeals">) => {
  const { token } = await ctx.params;
  return respondAppealHandler(req, token);
});
