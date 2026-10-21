import { caseOriginalsHandler } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/cases/{id}/originals: the owner's side and appeal as written. */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/cases/[id]/originals">) {
  const { id } = await ctx.params;
  return caseOriginalsHandler(req, id);
}
