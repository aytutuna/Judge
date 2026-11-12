import { ownerAppealHandler } from "@/lib/cases";
import { trialCompat } from "@/lib/trial-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Anonymize, then re-judging runs after the response (after()).
export const maxDuration = 300;

/** POST /api/v1/cases/{id}/appeals: the owner adds context and gets a re-judge. */
export const POST = trialCompat(async (req: Request, ctx: RouteContext<"/api/v1/cases/[id]/appeals">) => {
  const { id } = await ctx.params;
  return ownerAppealHandler(req, id);
});
