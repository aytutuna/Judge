import { liveCasesHandler } from "@/lib/cases";
import { trialCompat } from "@/lib/trial-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/cases/live: the live state of each side of the owner's waiting cases. */
export const GET = trialCompat(async (req: Request) => {
  return liveCasesHandler(req);
});
