import { respondRemovalHandler } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/respond/{token}/removal: removes Party B's side and closes the case's links. */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/respond/[token]/removal">) {
  const { token } = await ctx.params;
  return respondRemovalHandler(req, token);
}
