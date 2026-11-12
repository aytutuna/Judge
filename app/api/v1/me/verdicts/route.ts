import { myVerdictsHandler } from "@/lib/originals/http";
import { trialCompat } from "@/lib/trial-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/me/verdicts?limit=20&before=<ISO>: the account's one-sided verdicts. */
export const GET = trialCompat(async (req: Request) => {
  return myVerdictsHandler(req);
});
