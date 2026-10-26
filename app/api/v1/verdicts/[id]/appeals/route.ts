import { verdictAppealHandler } from "@/lib/verdict-appeals/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Anonymizing runs in the request; judging after the response (after()).
export const maxDuration = 300;

/** POST /api/v1/verdicts/{id}/appeals: the writer adds context and gets a re-judge. */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/verdicts/[id]/appeals">) {
  const { id } = await ctx.params;
  return verdictAppealHandler(req, id);
}
