/** POST /api/v1/verdict: the same handler as /api/verdict */
import { trialCompat } from "@/lib/trial-compat";
import { POST as verdictPost } from "@/app/api/verdict/route";

export const POST = trialCompat(verdictPost);

// Segment config is read statically from this file, so it is repeated here.
export const runtime = "nodejs";
export const maxDuration = 300;
