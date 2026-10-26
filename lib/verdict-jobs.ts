/**
 * Async one-sided verdicts (free and premium): one row per verdict being
 * judged in the background, keyed by the id the verdict will be stored
 * under. Server only.
 *
 * A job holds no content: no text, no names, only its state, the premium
 * reservation it holds and its owner account. The verdict row itself is
 * inserted only when judging succeeds, in one guarded batch with its
 * ownership row, its sealed original, the credit settlement and the job's
 * move to 'ready'. Every statement of that batch requires the job to still
 * be 'judging', so a run the sweep already failed writes nothing. A failure
 * moves the job to 'failed' and refunds the reservation in one batch. Rows
 * are never deleted.
 *
 * Crash safety: a job still 'judging' after STALE_JOB_MS (the process died
 * or was restarted mid-run) is failed and refunded by the sweep, which runs
 * at startup (instrumentation.ts), every few minutes, and lazily when a
 * client polls a stale job.
 */

import type { Client, InStatement, Row } from "@libsql/client";
import { getDb } from "@/lib/db";
import {
  consumeStatement,
  ensureEntitlementTables,
  entitlementWriteBatch,
  refundStatements,
  type StatementGuard,
} from "@/lib/entitlements";
import { ensureOriginalsTables } from "@/lib/originals/db";
import {
  PLAIN_SAVE_OUTCOME,
  plainVerdictStatement,
  verdictWriteStatements,
  type SaveVerdictInput,
  type SaveVerdictOutcome,
} from "@/lib/originals/save";
import type { VerdictJobErrorCode, VerdictJobStatus } from "@/lib/verdict-poll";

/** A job still judging after this long is failed and refunded. The
 * pipelines' own deadline gates end a run well inside it (about 5 minutes). */
export const STALE_JOB_MS = 10 * 60_000;
const SWEEP_EVERY_MS = 60_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;
const BATCH_LIMIT = 100;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS verdict_jobs (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL CHECK (kind IN ('free','premium')),
    status          TEXT NOT NULL CHECK (status IN ('judging','ready','failed')),
    error_code      TEXT CHECK (error_code IN ('quota','unavailable','refused')),
    reservation_id  TEXT,
    owner_user_id   TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS verdict_jobs_judging ON verdict_jobs (created_at) WHERE status = 'judging'",
  "CREATE INDEX IF NOT EXISTS verdict_jobs_reservation ON verdict_jobs (reservation_id) WHERE reservation_id IS NOT NULL",
];

const globalForJobs = globalThis as unknown as {
  __verdictJobsReady?: { client: Client; ready: Promise<void> };
  __verdictJobsLastSweep?: number;
  __verdictJobsSweeper?: boolean;
};

/** Creates the job table (after the entitlement and originals tables its
 * batches touch), once per process. Idempotent. */
export async function ensureVerdictJobTables(): Promise<void> {
  await ensureEntitlementTables();
  await ensureOriginalsTables();
  const client = await getDb();
  const cached = globalForJobs.__verdictJobsReady;
  if (cached?.client === client) return cached.ready;
  const ready = client.batch(SCHEMA, "write").then(
    () => undefined,
    (e: unknown) => {
      globalForJobs.__verdictJobsReady = undefined;
      throw e;
    },
  );
  globalForJobs.__verdictJobsReady = { client, ready };
  return ready;
}

async function jobsDb(): Promise<Client> {
  await ensureVerdictJobTables();
  return getDb();
}

export type VerdictJob = {
  id: string;
  kind: "free" | "premium";
  status: VerdictJobStatus;
  errorCode: VerdictJobErrorCode | null;
  reservationId: string | null;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

const COLUMNS = "id, kind, status, error_code, reservation_id, owner_user_id, created_at, updated_at";

function toJob(row: Row): VerdictJob {
  const str = (v: unknown) => (v == null ? null : String(v));
  return {
    id: String(row.id),
    kind: String(row.kind) as VerdictJob["kind"],
    status: String(row.status) as VerdictJobStatus,
    errorCode: str(row.error_code) as VerdictJobErrorCode | null,
    reservationId: str(row.reservation_id),
    ownerUserId: str(row.owner_user_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

type NewJob = { id: string; kind: VerdictJob["kind"]; reservationId?: string | null; ownerUserId?: string | null };

/** The insert of a job in 'judging', skipped unless `guard` holds. */
export function jobInsertStatement(job: NewJob, nowIso: string, guard?: StatementGuard): InStatement {
  const args = [job.id, job.kind, job.reservationId ?? null, job.ownerUserId ?? null, nowIso, nowIso];
  return guard
    ? {
        sql: `INSERT INTO verdict_jobs (${COLUMNS}) SELECT ?, ?, 'judging', NULL, ?, ?, ?, ? WHERE ${guard.sql}`,
        args: [...args, ...guard.args],
      }
    : { sql: `INSERT INTO verdict_jobs (${COLUMNS}) VALUES (?, ?, 'judging', NULL, ?, ?, ?, ?)`, args };
}

/** Starts a job in 'judging'. Throws when it cannot be written. */
export async function createVerdictJob(job: NewJob, now: Date = new Date()): Promise<void> {
  await ensureVerdictJobTables();
  await entitlementWriteBatch([jobInsertStatement(job, now.toISOString())]);
}

/** One primary-key read; null when there is no job with that id. */
export async function getVerdictJob(id: string): Promise<VerdictJob | null> {
  const db = await jobsDb();
  const rs = await db.execute({ sql: `SELECT ${COLUMNS} FROM verdict_jobs WHERE id = ?`, args: [id] });
  return rs.rows[0] ? toJob(rs.rows[0]) : null;
}

/** The job still judging on this user's Idempotency-Key, if any (a retried
 * premium request joins it instead of answering in_progress). */
export async function judgingJobForKey(userId: string, key: string): Promise<VerdictJob | null> {
  const db = await jobsDb();
  const rs = await db.execute({
    sql: `SELECT ${COLUMNS.split(", ").map((c) => `j.${c}`).join(", ")}
          FROM verdict_jobs j JOIN premium_usage p ON p.id = j.reservation_id
          WHERE p.user_id = ? AND p.idempotency_key = ? AND p.status = 'reserved' AND j.status = 'judging'
          LIMIT 1`,
    args: [userId, key],
  });
  return rs.rows[0] ? toJob(rs.rows[0]) : null;
}

export function isStale(job: Pick<VerdictJob, "status" | "createdAt">, now: Date = new Date()): boolean {
  return job.status === "judging" && job.createdAt < new Date(now.getTime() - STALE_JOB_MS).toISOString();
}

export const judgingGuard = (id: string): StatementGuard => ({
  sql: "EXISTS (SELECT 1 FROM verdict_jobs WHERE id = ? AND status = 'judging')",
  args: [id],
});

/** judging -> failed with `code`, plus the refund of its reservation, one batch. */
export function failJobStatements(
  id: string,
  reservationId: string | null,
  code: VerdictJobErrorCode,
  nowIso: string,
): InStatement[] {
  const stmts: InStatement[] = [
    {
      sql: "UPDATE verdict_jobs SET status = 'failed', error_code = ?, updated_at = ? WHERE id = ? AND status = 'judging'",
      args: [code, nowIso, id],
    },
  ];
  if (reservationId) {
    stmts.push(
      ...refundStatements(reservationId, nowIso, {
        sql: "EXISTS (SELECT 1 FROM verdict_jobs WHERE id = ? AND status = 'failed' AND reservation_id = ?)",
        args: [id, reservationId],
      }),
    );
  }
  return stmts;
}

/** Fails a judging job (and refunds). False when it was no longer judging. */
export async function failVerdictJob(
  id: string,
  code: VerdictJobErrorCode,
  reservationId: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  await ensureVerdictJobTables();
  const rs = await entitlementWriteBatch(failJobStatements(id, reservationId, code, now.toISOString()));
  return rs[0].rowsAffected === 1;
}

export type JobSettlement = "consume" | "refund" | "none";

/**
 * Stores a judged verdict for its job: the full save (verdict, ownership,
 * sealed original), the settlement of its reservation (consumed, or
 * refunded for a refused/degraded premium verdict) and judging -> ready, as
 * one guarded batch. `extra` statements run in it too, after the save; they
 * must carry their own guard (judgingGuard). If that batch fails, the
 * verdict row alone is stored the same way (the outcome then says nothing
 * else was). `stored` is false when the job was no longer judging (nothing
 * was written). Throws when the plain batch fails too; the caller fails the job.
 */
export async function completeVerdictJob(
  v: SaveVerdictInput,
  opts: { ownerToken: string | null; reservationId: string | null; settle: JobSettlement; extra?: InStatement[] },
): Promise<{ stored: boolean; outcome: SaveVerdictOutcome }> {
  await ensureVerdictJobTables();
  const guard = judgingGuard(v.id);
  const nowIso = new Date().toISOString();
  const settle: InStatement[] =
    opts.reservationId && opts.settle === "consume"
      ? [consumeStatement(opts.reservationId, v.id, nowIso, guard)]
      : opts.reservationId && opts.settle === "refund"
        ? refundStatements(opts.reservationId, nowIso, guard)
        : [];
  // Last, so every statement before it still sees the job judging.
  const ready: InStatement = {
    sql: "UPDATE verdict_jobs SET status = 'ready', updated_at = ? WHERE id = ? AND status = 'judging'",
    args: [nowIso, v.id],
  };
  try {
    const { stmts, outcome } = verdictWriteStatements(v, { ownerToken: opts.ownerToken, guard });
    const rs = await entitlementWriteBatch([...stmts, ...(opts.extra ?? []), ...settle, ready]);
    return { stored: rs[rs.length - 1].rowsAffected === 1, outcome };
  } catch (e) {
    console.error("[verdict-jobs] meta write failed:", e instanceof Error ? e.message : String(e));
  }
  const rs = await entitlementWriteBatch([plainVerdictStatement(v, guard), ...(opts.extra ?? []), ...settle, ready]);
  return { stored: rs[rs.length - 1].rowsAffected === 1, outcome: { ...PLAIN_SAVE_OUTCOME } };
}

/** Fails (and refunds) every job judging for over STALE_JOB_MS. Returns how
 * many it failed. Each job is its own guarded batch. */
export async function sweepVerdictJobs(now: Date = new Date()): Promise<number> {
  globalForJobs.__verdictJobsLastSweep = now.getTime();
  const db = await jobsDb();
  const staleIso = new Date(now.getTime() - STALE_JOB_MS).toISOString();
  const rs = await db.execute({
    sql: "SELECT id, reservation_id FROM verdict_jobs WHERE status = 'judging' AND created_at < ? LIMIT ?",
    args: [staleIso, BATCH_LIMIT],
  });
  let failed = 0;
  for (const row of rs.rows) {
    const id = String(row.id);
    const reservationId = row.reservation_id == null ? null : String(row.reservation_id);
    if (await failVerdictJob(id, "unavailable", reservationId, now)) {
      failed += 1;
      console.warn(`[verdict-jobs] stale job failed id=${id}`);
    }
  }
  return failed;
}

/** sweepVerdictJobs at most once a minute per process; fails open. */
export async function maybeSweepVerdictJobs(now: Date = new Date()): Promise<void> {
  const last = globalForJobs.__verdictJobsLastSweep;
  if (last !== undefined && Math.abs(now.getTime() - last) < SWEEP_EVERY_MS) return;
  try {
    await sweepVerdictJobs(now);
  } catch (e) {
    console.error("[verdict-jobs] sweep failed:", e instanceof Error ? e.message : String(e));
  }
}

/** Server startup: one sweep now, then every few minutes (the timer never
 * keeps the process alive). Once per process. */
export function startVerdictJobSweeper(): void {
  if (globalForJobs.__verdictJobsSweeper) return;
  globalForJobs.__verdictJobsSweeper = true;
  void maybeSweepVerdictJobs();
  const timer = setInterval(() => void maybeSweepVerdictJobs(), SWEEP_INTERVAL_MS);
  timer.unref?.();
}
