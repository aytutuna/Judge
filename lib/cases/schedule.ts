import { after } from "next/server";

/**
 * Runs judging after the response is sent (Next's after(), supported under
 * `next start`). Outside a request scope (scripts, unit tests) after()
 * throws, so the work just starts in the background. A judging run that is
 * lost to a hard kill is failed and refunded by the 10-minute sweep.
 */
export function scheduleJudging(fn: () => Promise<void>): void {
  const run = () =>
    fn().catch((e: unknown) => {
      console.error("[cases] background judging failed:", e instanceof Error ? e.message : String(e));
    });
  try {
    after(run);
  } catch {
    void run();
  }
}
