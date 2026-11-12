import { respondGetHandler, respondPostHandler } from "@/lib/cases";
import { trialCompat } from "@/lib/trial-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Anonymize side B, then judging runs after the response (after()).
export const maxDuration = 300;

/** GET /api/v1/respond/{token}: the invite, as the other person sees it. */
export const GET = trialCompat(async (req: Request, ctx: RouteContext<"/api/v1/respond/[token]">) => {
  const { token } = await ctx.params;
  return respondGetHandler(req, token);
});

/** POST /api/v1/respond/{token}: the other person's side (no account needed). */
export const POST = trialCompat(async (req: Request, ctx: RouteContext<"/api/v1/respond/[token]">) => {
  const { token } = await ctx.params;
  return respondPostHandler(req, token);
});
