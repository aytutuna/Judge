import { respondAppealHandler } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/v1/respond/{token}/appeals: a signed-in Premium respondent adds context. */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/respond/[token]/appeals">) {
  const { token } = await ctx.params;
  return respondAppealHandler(req, token);
}
