import { respondOpenHandler } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/respond/{token}/open: takes the next open side and returns its claim secret. */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/respond/[token]/open">) {
  const { token } = await ctx.params;
  return respondOpenHandler(req, token);
}
