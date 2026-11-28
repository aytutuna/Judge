import { importBatch, parseBatch, tableCounts } from "@/lib/d1-import";
import { getDb } from "@/lib/db";
import { internalAuthorized } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The cutover copy (scripts/d1-copy.ts). Closed (404) unless IMPORT_ENABLED=1
 * and the request carries JOB_SECRET; unset IMPORT_ENABLED again afterwards. */
const open = (req: Request) => process.env.IMPORT_ENABLED === "1" && internalAuthorized(req);

/** POST: one batch of rows {table, columns, rows}. GET: the row count of every table. */
export async function POST(req: Request): Promise<Response> {
  if (!open(req)) return new Response("Not found\n", { status: 404 });
  const batch = parseBatch(await req.json().catch(() => null));
  if (!batch) return new Response("bad batch\n", { status: 400 });
  try {
    return Response.json({ written: await importBatch(await getDb(), batch) });
  } catch (e) {
    return new Response(`${e instanceof Error ? e.message : String(e)}\n`, { status: 422 });
  }
}

export async function GET(req: Request): Promise<Response> {
  if (!open(req)) return new Response("Not found\n", { status: 404 });
  return Response.json(await tableCounts(await getDb()));
}
