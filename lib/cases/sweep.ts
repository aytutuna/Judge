/**
 * Expiry and crash recovery for cases. Correctness never depends on the
 * sweep: every read reports an unanswered case past expires_at as expired,
 * and the first write materializes it. The sweep only tidies up (and the
 * entitlements sweep refunds any held unit 10 minutes after hold_until as a
 * last backstop).
 */

import type { InStatement } from "@libsql/client";
import { entitlementWriteBatch, refundStatements } from "@/lib/entitlements";
import type { CaseStatus } from "@/lib/case-types";
import { caseDb, type CaseRow } from "./db";

/** A judging run or appeal still "judging" after this long is failed and refunded. */
export const STALE_JUDGING_MS = 10 * 60_000;
const SWEEP_EVERY_MS = 60_000;
const BATCH_LIMIT = 100;

const globalForSweep = globalThis as unknown as { __verdictCasesLastSweep?: number };

/** What every reader reports: an unanswered case past its expiry is expired. */
export function effectiveStatus(row: Pick<CaseRow, "status" | "expiresAt">, now: Date): CaseStatus {
  return row.status === "awaiting_respondent" && row.expiresAt <= now.toISOString() ? "expired" : row.status;
}

/** awaiting -> expired plus the refund of the held unit, one batch. */
export function expireStatements(caseId: string, reservationId: string | null, nowIso: string): InStatement[] {
  const stmts: InStatement[] = [
    {
      sql: `UPDATE cases SET status = 'expired', updated_at = ?
            WHERE id = ? AND status = 'awaiting_respondent' AND expires_at <= ?`,
      args: [nowIso, caseId, nowIso],
    },
  ];
  if (reservationId) {
    stmts.push(
      ...refundStatements(reservationId, nowIso, {
        sql: "EXISTS (SELECT 1 FROM cases WHERE id = ? AND status = 'expired' AND reservation_id = ?)",
        args: [caseId, reservationId],
      }),
    );
  }
  return stmts;
}

/** Materializes an expired case (status + refund). No-op otherwise. */
export async function materializeExpiry(row: CaseRow, now: Date = new Date()): Promise<void> {
  if (effectiveStatus(row, now) !== "expired" || row.status !== "awaiting_respondent") return;
  await entitlementWriteBatch(expireStatements(row.id, row.reservationId, now.toISOString()));
}

/** judging -> failed (unavailable) plus the refund, guarded by the run's token. */
export function failJudgingStatements(
  caseId: string,
  judgingToken: string,
  reservationId: string | null,
  code: "quota" | "unavailable",
  nowIso: string,
): InStatement[] {
  const stmts: InStatement[] = [
    {
      sql: `UPDATE cases SET status = 'failed', last_error = ?, updated_at = ?
            WHERE id = ? AND status = 'judging' AND judging_token = ?`,
      args: [code, nowIso, caseId, judgingToken],
    },
  ];
  if (reservationId) {
    stmts.push(
      ...refundStatements(reservationId, nowIso, {
        sql: "EXISTS (SELECT 1 FROM cases WHERE id = ? AND status = 'failed' AND reservation_id = ?)",
        args: [caseId, reservationId],
      }),
    );
  }
  return stmts;
}

/** An appeal attempt -> failed plus the refund, guarded by its attempt token. */
export function failAppealStatements(
  appealId: string,
  attemptToken: string,
  reservationId: string,
  error: "quota" | "unavailable" | "refused",
  nowIso: string,
): InStatement[] {
  return [
    {
      sql: `UPDATE case_appeals SET status = 'failed', error = ?, updated_at = ?
            WHERE id = ? AND status = 'judging' AND attempt_token = ?`,
      args: [error, nowIso, appealId, attemptToken],
    },
    ...refundStatements(reservationId, nowIso, {
      sql: "EXISTS (SELECT 1 FROM case_appeals WHERE id = ? AND status = 'failed' AND attempt_token = ?)",
      args: [appealId, attemptToken],
    }),
  ];
}

export type SweepResult = { expired: number; failed: number; appealsFailed: number };

/** One pass: expire unanswered cases, fail stale judging runs and appeals.
 * Each item is its own guarded batch. */
export async function sweepCases(now: Date = new Date()): Promise<SweepResult> {
  globalForSweep.__verdictCasesLastSweep = now.getTime();
  const db = await caseDb();
  const nowIso = now.toISOString();
  const staleIso = new Date(now.getTime() - STALE_JUDGING_MS).toISOString();
  const result: SweepResult = { expired: 0, failed: 0, appealsFailed: 0 };

  const expired = await db.execute({
    sql: "SELECT id, reservation_id FROM cases WHERE status = 'awaiting_respondent' AND expires_at <= ? LIMIT ?",
    args: [nowIso, BATCH_LIMIT],
  });
  for (const r of expired.rows) {
    const rs = await entitlementWriteBatch(
      expireStatements(String(r.id), r.reservation_id == null ? null : String(r.reservation_id), nowIso),
    );
    if (rs[0].rowsAffected === 1) result.expired += 1;
  }

  const stale = await db.execute({
    sql: `SELECT id, judging_token, reservation_id FROM cases
          WHERE status = 'judging' AND judging_started_at < ? LIMIT ?`,
    args: [staleIso, BATCH_LIMIT],
  });
  for (const r of stale.rows) {
    const rs = await entitlementWriteBatch(
      failJudgingStatements(
        String(r.id),
        String(r.judging_token ?? ""),
        r.reservation_id == null ? null : String(r.reservation_id),
        "unavailable",
        nowIso,
      ),
    );
    if (rs[0].rowsAffected === 1) result.failed += 1;
  }

  const appeals = await db.execute({
    sql: `SELECT id, attempt_token, reservation_id FROM case_appeals
          WHERE status = 'judging' AND updated_at < ? LIMIT ?`,
    args: [staleIso, BATCH_LIMIT],
  });
  for (const r of appeals.rows) {
    const rs = await entitlementWriteBatch(
      failAppealStatements(String(r.id), String(r.attempt_token), String(r.reservation_id), "unavailable", nowIso),
    );
    if (rs[0].rowsAffected === 1) result.appealsFailed += 1;
  }
  return result;
}

/** sweepCases at most once a minute per process; fails open with a log line. */
export async function maybeSweepCases(now: Date = new Date()): Promise<void> {
  const last = globalForSweep.__verdictCasesLastSweep;
  if (last !== undefined && Math.abs(now.getTime() - last) < SWEEP_EVERY_MS) return;
  try {
    await sweepCases(now);
  } catch (e) {
    console.error("[cases] sweep failed:", e instanceof Error ? e.message : String(e));
  }
}
