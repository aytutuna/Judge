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
import { backupConfigured, runBackup, type BackupEnv } from "@/lib/backup";
import { readRemovalBucket } from "@/lib/originals/removal-log";
import { replayEntries } from "@/lib/originals/removal-replay";
import { sweepVerdictJobs } from "@/lib/verdict-jobs";
import { workerEnv } from "@/lib/worker-env";

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
  /** Nightly: the encrypted copy of the database in R2. Unset settings skip it, loudly. */
  backup: async () => {
    const env: Partial<BackupEnv> = { ...workerEnv(), ...process.env };
    if (!backupConfigured(env)) {
      console.error("[alert:backup] no off-platform copy: BACKUPS, CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID, CLOUDFLARE_API_TOKEN or BACKUP_PASSPHRASE is not set");
      return;
    }
    const done = await runBackup(env);
    console.info(`[backup] wrote ${done.key} (${done.bytes} bytes), deleted ${done.deleted} old`);
  },
  /** By hand after a restore (not in the crons): applies every removal in the R2 log again. */
  "replay-removals": async () => {
    const log = await readRemovalBucket();
    console.info(`[cron] replay-removals ${JSON.stringify(await replayEntries(log.entries))} skipped=${log.skipped}`);
  },
  daily: () => each({ events: pruneEvents, erasure: sweepErasures, cleanup: runCleanup }),
} satisfies Record<string, () => Promise<void>>;

export type CronTask = keyof typeof CRON_TASKS;

export const isCronTask = (name: unknown): name is CronTask => typeof name === "string" && Object.hasOwn(CRON_TASKS, name);

export function runCronTask(task: CronTask): Promise<void> {
  return CRON_TASKS[task]();
}
