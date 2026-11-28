import { isCronTask, runCronTask } from "@/lib/cron";
import { internalAuthorized } from "@/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/internal/cron?task=<name>&cursor=<key>: one scheduled task (lib/cron.ts). Called by
 * the Worker's Cron Triggers with JOB_SECRET; 404 for anyone else. */
export async function POST(req: Request): Promise<Response> {
  if (!internalAuthorized(req)) return new Response("Not found\n", { status: 404 });
  const params = new URL(req.url).searchParams;
  const task = params.get("task");
  if (!isCronTask(task)) return new Response("unknown task\n", { status: 400 });
  return Response.json({ done: true, ...(await runCronTask(task, params)) });
}
