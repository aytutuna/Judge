import { after } from "next/server";

/**
 * Runs `fn` after the response is sent (Next's after(), fully supported
 * under `next start`; Vercel keeps the invocation alive for the route's
 * maxDuration). Outside a request scope (scripts, unit tests) after()
 * throws, so the work just starts in the background. Work lost to a hard
 * kill is cleaned up by the caller's sweep. Never throws.
 */
export function runInBackground(label: string, fn: () => Promise<void>): void {
  const run = () =>
    fn().catch((e: unknown) => {
      console.error(`[${label}] background work failed:`, e instanceof Error ? e.message : String(e));
    });
  try {
    after(run);
  } catch {
    void run();
  }
}
