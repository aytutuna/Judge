import { rotateInviteHandler } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/cases/{id}/invite: a new invite link; the old one stops working. */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/cases/[id]/invite">) {
  const { id } = await ctx.params;
  return rotateInviteHandler(req, id);
}
