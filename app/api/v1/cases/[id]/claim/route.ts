import { respondentClaimHandler } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/cases/{id}/claim { claim }: keeps a side B answered signed out in the account. */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/cases/[id]/claim">) {
  const { id } = await ctx.params;
  return respondentClaimHandler(req, id);
}
