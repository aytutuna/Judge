import { respondOpenHandler } from "@/lib/cases";
import { trialCompat } from "@/lib/trial-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/respond/{token}/open: takes the next open side and returns its claim secret. */
export const POST = trialCompat(async (req: Request, ctx: RouteContext<"/api/v1/respond/[token]/open">) => {
  const { token } = await ctx.params;
  return respondOpenHandler(req, token);
});
