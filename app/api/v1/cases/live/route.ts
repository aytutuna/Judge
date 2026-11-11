import { liveCasesHandler } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/cases/live: the live state of each side of the owner's waiting cases. */
export async function GET(req: Request) {
  return liveCasesHandler(req);
}
