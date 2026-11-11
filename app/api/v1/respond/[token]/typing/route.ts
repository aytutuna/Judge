import { respondTypingHandler } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/respond/{token}/typing: heartbeat while the holder of a side is writing. */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/respond/[token]/typing">) {
  const { token } = await ctx.params;
  return respondTypingHandler(req, token);
}
