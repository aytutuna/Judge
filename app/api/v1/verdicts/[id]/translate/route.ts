/** POST /api/v1/verdicts/{id}/translate?lang=<an enabled language>: the same handler as
 * /api/verdict/{id}/translate. */
import { trialCompat } from "@/lib/trial-compat";
import { POST as translatePost } from "@/app/api/verdict/[id]/translate/route";

export const POST = trialCompat(translatePost);

// Segment config is read statically from this file, so it is repeated here.
export const runtime = "nodejs";
export const maxDuration = 90;
