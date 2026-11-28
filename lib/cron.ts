/**
 * The work the Node server does from timers in instrumentation.ts, as named
 * tasks for Cron Triggers (cloudflare/worker.ts calls POST
 * /api/internal/cron?task=<name>). A failing step is logged and does not hold
 * back the others.
 */

import { pruneEvents } from "@/lib/analytics/db";
import { sweepCases } from "@/lib/cases/sweep";
import { runCleanup } from "@/lib/cleanup";
import { sweepStaleReservations } from "@/lib/entitlements";
import { sweepErasures } from "@/lib/erasure";
import { sweepVerdictJobs } from "@/lib/verdict-jobs";

async function each(steps: Record<string, () => Promise<unknown>>): Promise<void> {
  for (const [name, step] of Object.entries(steps)) {
    try {
      await step();
    } catch (e) {
      console.error(`[cron] ${name} failed:`, e instanceof Error ? e.message : String(e));
    }
  }
}

export const CRON_TASKS = {
  /** Every 5 minutes: jobs, cases and credit reservations left behind by a lost run. */
  sweep: () => each({ jobs: sweepVerdictJobs, cases: sweepCases, reservations: sweepStaleReservations }),
  /** Once a day: retention (events, removed text, sign-in codes, consent and removal logs). */
  daily: () => each({ events: pruneEvents, erasure: sweepErasures, cleanup: runCleanup }),
} satisfies Record<string, () => Promise<void>>;

export type CronTask = keyof typeof CRON_TASKS;

export const isCronTask = (name: unknown): name is CronTask => typeof name === "string" && Object.hasOwn(CRON_TASKS, name);

export function runCronTask(task: CronTask): Promise<void> {
  return CRON_TASKS[task]();
}
