import { respondDisplayHandler } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/v1/respond/{token}/display: Party B's display name. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/v1/respond/[token]/display">) {
  const { token } = await ctx.params;
  return respondDisplayHandler(req, token);
}
