import { internalAuthorized } from "@/lib/internal-auth";
import { isJobName, runJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/internal/job: runs one background job to the end. Called by the
 * JobRunner Durable Object (cloudflare/job-runner.ts) with JOB_SECRET; 404
 * for anyone else. The answer comes when the job is done. */
export async function POST(req: Request): Promise<Response> {
  if (!internalAuthorized(req)) return new Response("Not found\n", { status: 404 });
  const body = (await req.json().catch(() => null)) as { name?: unknown; args?: unknown } | null;
  if (!body || !isJobName(body.name) || !Array.isArray(body.args)) return new Response("bad job\n", { status: 400 });
  try {
    await runJob({ name: body.name, args: body.args });
  } catch (e) {
    console.error(`[job] ${body.name} failed:`, e instanceof Error ? e.message : String(e));
    return new Response("failed\n", { status: 500 });
  }
  return new Response("done\n");
}
