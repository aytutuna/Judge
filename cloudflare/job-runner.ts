import * as Sentry from "@sentry/cloudflare";
import { DurableObject } from "cloudflare:workers";

export type Env = { WORKER_SELF_REFERENCE: Fetcher; JOB_SECRET: string; SENTRY_DSN?: string };
type Job = { name: string; args: unknown[] };

/**
 * Runs one background job (lib/jobs.ts) outside the request that started it:
 * a Worker request may only run 30 seconds after its response, an alarm
 * handler much longer. The job goes in memory, never to storage, because
 * its arguments can hold what people wrote. The alarm calls back into the
 * app, which runs the job to the end. It never throws, so Cloudflare never
 * retries an alarm and judges twice; an object evicted before the alarm
 * loses its job, and the stale-job sweep refunds it.
 */
export class JobRunner extends DurableObject<Env> {
  private job?: Job;

  async enqueue(job: Job): Promise<void> {
    this.job = job;
    await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm(): Promise<void> {
    const job = this.job;
    this.job = undefined;
    if (!job) return;
    const started = Date.now();
    try {
      const res = await this.env.WORKER_SELF_REFERENCE.fetch("https://judge.internal/api/internal/job", {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-secret": this.env.JOB_SECRET },
        body: JSON.stringify(job),
      });
      if (!res.ok) {
        console.error(`[job-runner] ${job.name} answered HTTP ${res.status}`);
        Sentry.captureMessage(`job ${job.name} answered HTTP ${res.status}`, "error");
      } else console.info(`[job-runner] ${job.name} finished in ${Date.now() - started} ms`);
    } catch (e) {
      console.error(`[job-runner] ${job.name} failed:`, e instanceof Error ? e.message : String(e));
      Sentry.captureException(e);
    }
  }
}
