import { writeSideHandler } from "@/lib/cases";
import { trialCompat } from "@/lib/trial-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Anonymize side A; when the other side is already in, judging runs after the response (after()).
export const maxDuration = 300;

/** POST /api/v1/cases/{id}/side: the owner writes side A of a case started without it. */
export const POST = trialCompat(async (req: Request, ctx: RouteContext<"/api/v1/cases/[id]/side">) => {
  const { id } = await ctx.params;
  return writeSideHandler(req, id);
});
