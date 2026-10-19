/** POST /api/v1/verdicts/{id}/translate?lang=en|tr: the same handler as
 * /api/verdict/{id}/translate. */
export { POST } from "@/app/api/verdict/[id]/translate/route";

// Segment config is read statically from this file, so it is repeated here.
export const runtime = "nodejs";
export const maxDuration = 90;
