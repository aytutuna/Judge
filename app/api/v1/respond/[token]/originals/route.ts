import { respondOriginalsHandler } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/respond/{token}/originals: Party B's side and appeal as written. */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/respond/[token]/originals">) {
  const { token } = await ctx.params;
  return respondOriginalsHandler(req, token);
}
