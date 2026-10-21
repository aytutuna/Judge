import { myVerdictsHandler } from "@/lib/originals/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/me/verdicts?limit=20&before=<ISO>: the account's one-sided verdicts. */
export async function GET(req: Request) {
  return myVerdictsHandler(req);
}
