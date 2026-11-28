import { after } from "next/server";
import { backgroundWork, type JobSpec } from "@/lib/jobs";

/**
 * Runs judging after the response is sent (Next's after(), supported under
 * `next start`; on Workers the named job goes to a Durable Object, see
 * lib/jobs.ts). Outside a request scope (scripts, unit tests) after()
 * throws, so the work just starts in the background. A judging run that is
 * lost to a hard kill is failed and refunded by the 10-minute sweep.
 */
export function scheduleJudging(fn: () => Promise<void>, job?: JobSpec): void {
  const work = backgroundWork(fn, job);
  const run = () =>
    work().catch((e: unknown) => {
      console.error("[cases] background judging failed:", e instanceof Error ? e.message : String(e));
    });
  try {
    after(run);
  } catch {
    void run();
  }
}
