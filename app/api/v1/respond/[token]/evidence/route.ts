import { respondEvidenceHandler } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Up to 3 parallel image transcriptions (45s each), with headroom.
export const maxDuration = 90;

/** POST /api/v1/respond/{token}/evidence: the respondent's screenshots (multipart or JSON). */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/respond/[token]/evidence">) {
  const { token } = await ctx.params;
  return respondEvidenceHandler(req, token);
}
