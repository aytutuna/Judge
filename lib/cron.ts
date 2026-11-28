/**
 * The work the Node server does from timers in instrumentation.ts, as named
 * tasks for Cron Triggers (cloudflare/worker.ts calls POST
 * /api/internal/cron?task=<name>). Each task is its own invocation: a Worker
 * invocation may make 1,000 D1 queries, so work that can be long is split
 * across tasks (and replay-removals pages). A failing step is logged and does
 * not hold back the others.
 */

import { pruneEvents } from "@/lib/analytics/db";
import { sweepCases } from "@/lib/cases/sweep";
import { runCleanup } from "@/lib/cleanup";
import { sweepStaleReservations } from "@/lib/entitlements";
import { sweepErasures } from "@/lib/erasure";
import { alertSentry } from "@/lib/alert";
import { backupConfigured, runBackup, type BackupEnv } from "@/lib/backup";
import { readRemovalBucket } from "@/lib/originals/removal-log";
import { replayEntries } from "@/lib/originals/removal-replay";
import { getDb } from "@/lib/db";
import { runBackfills } from "@/lib/originals/db";
import { sweepVerdictJobs } from "@/lib/verdict-jobs";
import { workerEnv } from "@/lib/worker-env";

export const REPLAY_PAGE = 50;
/** Erasure passes per run; each handles up to 100 verdicts and 100 cases. */
const ERASURE_PASSES = 10;

async function each(steps: Record<string, () => Promise<unknown>>): Promise<void> {
  for (const [name, step] of Object.entries(steps)) {
    try {
      await step();
    } catch (e) {
      console.error(`[cron] ${name} failed:`, e instanceof Error ? e.message : String(e));
    }
  }
}

/** What a task answers: `next` is set when it stopped early and a rerun with `cursor=<next>` continues. */
export type CronResult = { next?: string | null } | void;
type Task = (params: URLSearchParams) => Promise<CronResult>;

export const CRON_TASKS = {
  /** Every 5 minutes: jobs, cases and credit reservations left behind by a lost run. */
  sweep: () => each({ jobs: sweepVerdictJobs, cases: sweepCases, reservations: sweepStaleReservations }),
  /** Daily: usage events and device links past their retention. */
  events: () => each({ events: pruneEvents }),
  /** Daily: the text of verdicts and cases removed over 30 days ago. */
  erasure: () =>
    each({
      erasure: async () => {
        for (let pass = 0; pass < ERASURE_PASSES; pass++) {
          const n = await sweepErasures();
          if (!n.verdicts && !n.cases) return;
        }
      },
    }),
  /** Daily: expired sign-in codes, old consent and removal-log records, blocked accounts. */
  cleanup: () => each({ cleanup: runCleanup }),
  /** Daily: the data fixes the Node server makes at startup (metadata for old verdicts, names off for teens). */
  backfill: async () => runBackfills(await getDb()),
  /** Nightly: the encrypted copy of the database in R2. Unset settings skip it, loudly. */
  backup: async () => {
    const env: Partial<BackupEnv> = { ...workerEnv(), ...process.env };
    if (!backupConfigured(env)) {
      const why = "no off-platform copy: BACKUPS or BACKUP_PASSPHRASE is not set";
      console.error(`[alert:backup] ${why}`);
      alertSentry("alert", "backup", why);
      return;
    }
    const done = await runBackup(env, await getDb());
    console.info(`[backup] wrote ${done.key} (${done.bytes} bytes), deleted ${done.deleted} old`);
  },
  /** By hand after a restore (not in the crons): applies the removals in the R2 log again,
   * REPLAY_PAGE at a time; rerun with the answer's `next` as `cursor` until it is null. */
  "replay-removals": async (params) => {
    const log = await readRemovalBucket({ after: params.get("cursor") ?? undefined, limit: REPLAY_PAGE });
    const report = await replayEntries(log.entries);
    console.info(`[cron] replay-removals ${JSON.stringify(report)} skipped=${log.skipped} next=${log.next}`);
    return { next: log.next };
  },
} satisfies Record<string, Task>;

export type CronTask = keyof typeof CRON_TASKS;

export const isCronTask = (name: unknown): name is CronTask => typeof name === "string" && Object.hasOwn(CRON_TASKS, name);

export async function runCronTask(task: CronTask, params: URLSearchParams = new URLSearchParams()): Promise<CronResult> {
  return (CRON_TASKS[task] as Task)(params);
}
