/** POST /api/v1/verdict: the same handler as /api/verdict */
export { POST } from "@/app/api/verdict/route";

// Segment config is read statically from this file, so it is repeated here.
export const runtime = "nodejs";
export const maxDuration = 300;
