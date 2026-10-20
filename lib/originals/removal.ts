/**
 * Removal: blanks personal data and closes public links. No row is ever
 * deleted: verdicts, case verdicts, cases, their sides and appeals, the
 * originals and ownership rows all stay; the sealed originals, name maps and
 * display names become NULL and `removed_at` closes the share page, its
 * preview image and the public JSON reads. Removal never needs the key.
 * Every removal is also appended to the removal log outside the database
 * (removal-log.ts), so a restored backup can have it applied again
 * (replayRemoval). Server only.
 */

import type { InStatement } from "@libsql/client";
import { getCase, type CaseRow } from "@/lib/cases/db";
import { entitlementWriteBatch, refundStatements } from "@/lib/entitlements";
import type { RemovalReason } from "@/lib/originals-types";
import { getVerdict } from "@/lib/db";
import { ensureOriginalsTables, getVerdictMeta, userBackfillStatements, type VerdictMeta } from "./db";
import { appendRemovalLog, type RemovalLogEntry } from "./removal-log";

/** `log: false`: do not append to the removal log (a replay of it). */
export type RemovalOptions = { log?: boolean };

const NOT_BUSY = `status <> 'judging'
  AND NOT EXISTS (SELECT 1 FROM case_appeals a WHERE a.case_id = cases.id AND a.status = 'judging')`;

function blankVerdictStatements(verdictId: string, reason: RemovalReason, nowIso: string): InStatement[] {
  return [
    {
      sql: `UPDATE verdict_meta SET removed_at = COALESCE(removed_at, ?), removal_reason = COALESCE(removal_reason, ?),
              display_sealed = NULL, display_key_id = NULL, names_visible = 0, updated_at = ?
            WHERE verdict_id = ?`,
      args: [nowIso, reason, nowIso, verdictId],
    },
    {
      sql: `UPDATE originals SET sealed = NULL, key_id = NULL, removed_at = COALESCE(removed_at, ?), updated_at = ?
            WHERE verdict_id = ?`,
      args: [nowIso, nowIso, verdictId],
    },
  ];
}

/** Removes a one-sided verdict (owner or operator). Idempotent: returns the
 * first removal time. */
export async function removeVerdict(
  meta: VerdictMeta,
  reason: RemovalReason,
  now: Date = new Date(),
  opts: RemovalOptions = {},
): Promise<string> {
  await ensureOriginalsTables();
  await entitlementWriteBatch(blankVerdictStatements(meta.verdictId, reason, now.toISOString()));
  const fresh = await getVerdictMeta(meta.verdictId);
  const removedAt = fresh?.removedAt ?? now.toISOString();
  if (opts.log !== false) await appendRemovalLog({ v: 1, at: removedAt, kind: "verdict", id: meta.verdictId, reason });
  return removedAt;
}

/** Operator removal of any one-sided verdict, including one stored before
 * this feature (no ownership row: a 'legacy' row is created, removed). */
export async function operatorRemoveVerdict(
  verdictId: string,
  now: Date = new Date(),
  opts: RemovalOptions = {},
): Promise<string> {
  await ensureOriginalsTables();
  const nowIso = now.toISOString();
  await entitlementWriteBatch([
    {
      sql: `INSERT INTO verdict_meta (verdict_id, kind, names_visible, removed_at, removal_reason, created_at, updated_at)
            VALUES (?, 'legacy', 0, ?, 'operator', ?, ?)
            ON CONFLICT(verdict_id) DO UPDATE SET removed_at = COALESCE(verdict_meta.removed_at, excluded.removed_at),
              removal_reason = COALESCE(verdict_meta.removal_reason, 'operator'), display_sealed = NULL,
              display_key_id = NULL, names_visible = 0, updated_at = excluded.updated_at`,
      args: [verdictId, nowIso, nowIso, nowIso],
    },
    {
      sql: `UPDATE originals SET sealed = NULL, key_id = NULL, removed_at = COALESCE(removed_at, ?), updated_at = ?
            WHERE verdict_id = ?`,
      args: [nowIso, nowIso, verdictId],
    },
  ]);
  const fresh = await getVerdictMeta(verdictId);
  const removedAt = fresh?.removedAt ?? nowIso;
  if (opts.log !== false) await appendRemovalLog({ v: 1, at: removedAt, kind: "verdict", id: verdictId, reason: "operator" });
  return removedAt;
}

/** One party's side of the cases selected by `where` (SQL over `cases`
 * columns): the case row, that party's originals, and every verdict of
 * those cases, each guarded by the case row actually carrying the removal. */
function caseSideStatements(
  party: "a" | "b",
  where: string,
  whereArgs: string[],
  reason: RemovalReason,
  nowIso: string,
): InStatement[] {
  const col = party === "a" ? "removed_a_at" : "removed_b_at";
  const display = party === "a" ? "display_a_sealed" : "display_b_sealed";
  const ids = `SELECT id FROM cases WHERE ${where} AND ${col} IS NOT NULL`;
  return [
    {
      sql: `UPDATE cases SET ${col} = COALESCE(${col}, ?), removed_at = COALESCE(removed_at, ?), ${display} = NULL,
              status = CASE WHEN status = 'awaiting_respondent' THEN 'expired' ELSE status END, updated_at = ?
            WHERE ${where}`,
      args: [nowIso, nowIso, nowIso, ...whereArgs],
    },
    {
      sql: `UPDATE originals SET sealed = NULL, key_id = NULL, removed_at = COALESCE(removed_at, ?), updated_at = ?
            WHERE party = ? AND case_id IN (${ids})`,
      args: [nowIso, nowIso, party, ...whereArgs],
    },
    {
      // Case verdicts written without an ownership row (before this feature,
      // after the process's backfill) get one, so they are closed too.
      sql: `INSERT OR IGNORE INTO verdict_meta (verdict_id, kind, case_id, names_visible, created_at, updated_at)
            SELECT cv.verdict_id, 'case', cv.case_id, 1, cv.created_at, ?
            FROM case_verdicts cv WHERE cv.case_id IN (${ids})`,
      args: [nowIso, ...whereArgs],
    },
    {
      sql: `UPDATE verdict_meta SET removed_at = COALESCE(removed_at, ?), removal_reason = COALESCE(removal_reason, ?),
              updated_at = ?
            WHERE case_id IN (${ids})`,
      args: [nowIso, reason, nowIso, ...whereArgs],
    },
  ];
}

export type CaseRemovalResult = { ok: true; row: CaseRow; removedAt: string } | { ok: false; code: "in_progress" | "not_found" };

/**
 * One party removes their side of a case: their original (side and appeal),
 * their display name, and every link of the case closes. Refused while
 * anything is judging (`ignoreBusy`: not refused, for a replay onto a
 * restored database while the app is stopped, where nothing can still be
 * judging). The owner removing a case that still waits for the answer
 * closes the invite and refunds the held unit. Idempotent.
 */
export async function removeCaseSide(
  row: CaseRow,
  party: "a" | "b",
  reason: RemovalReason,
  now: Date = new Date(),
  opts: RemovalOptions & { ignoreBusy?: boolean } = {},
): Promise<CaseRemovalResult> {
  const res = await removeCaseSideOnce(row, party, reason, now, opts.ignoreBusy === true);
  if (res.ok && opts.log !== false) {
    await appendRemovalLog({ v: 1, at: res.removedAt, kind: "case_side", id: row.id, party, reason });
  }
  return res;
}

async function removeCaseSideOnce(
  row: CaseRow,
  party: "a" | "b",
  reason: RemovalReason,
  now: Date,
  ignoreBusy: boolean,
): Promise<CaseRemovalResult> {
  await ensureOriginalsTables();
  const nowIso = now.toISOString();
  const where = ignoreBusy ? "id = ?" : `id = ? AND ${NOT_BUSY}`;
  const refund =
    party === "a" && row.reservationId
      ? refundStatements(row.reservationId, nowIso, {
          sql: `EXISTS (SELECT 1 FROM cases WHERE id = ? AND reservation_id = ? AND status IN ('awaiting_respondent','expired')
                AND removed_a_at IS NULL AND ${NOT_BUSY})`,
          args: [row.id, row.reservationId],
        })
      : [];
  const side = caseSideStatements(party, where, [row.id], reason, nowIso);
  const rs = await entitlementWriteBatch([...refund, ...side]);
  const fresh = await getCase(row.id);
  if (!fresh) return { ok: false, code: "not_found" };
  const removedAt = party === "a" ? fresh.removedAAt : fresh.removedBAt;
  if (rs[refund.length].rowsAffected === 1 && removedAt) return { ok: true, row: fresh, removedAt };
  return removedAt ? { ok: true, row: fresh, removedAt } : { ok: false, code: "in_progress" };
}

/**
 * Account deletion, in one batch: every verdict the user owns (including
 * premium verdicts saved before ownership rows existed), their side of
 * every case they started or answered, then the respondent bindings and
 * appeal authorship are cut loose. Held units are not refunded (the
 * entitlement rows are deleted right after).
 */
export async function removeUserData(userId: string, now: Date = new Date(), opts: RemovalOptions = {}): Promise<void> {
  await ensureOriginalsTables();
  const nowIso = now.toISOString();
  await entitlementWriteBatch([
    ...userBackfillStatements(userId, nowIso),
    {
      sql: `UPDATE originals SET sealed = NULL, key_id = NULL, removed_at = COALESCE(removed_at, ?), updated_at = ?
            WHERE verdict_id IN (SELECT verdict_id FROM verdict_meta WHERE owner_user_id = ?)`,
      args: [nowIso, nowIso, userId],
    },
    {
      sql: `UPDATE verdict_meta SET removed_at = COALESCE(removed_at, ?), removal_reason = COALESCE(removal_reason, 'account_deleted'),
              display_sealed = NULL, display_key_id = NULL, names_visible = 0, owner_user_id = NULL,
              owner_token_hash = NULL, updated_at = ?
            WHERE owner_user_id = ?`,
      args: [nowIso, nowIso, userId],
    },
    ...caseSideStatements("a", "owner_id = ?", [userId], "account_deleted", nowIso),
    ...caseSideStatements("b", "respondent_user_id = ?", [userId], "account_deleted", nowIso),
    {
      sql: "UPDATE cases SET respondent_user_id = NULL, respondent_claim_nonce = NULL WHERE respondent_user_id = ?",
      args: [userId],
    },
    { sql: "UPDATE case_appeals SET user_id = NULL WHERE user_id = ?", args: [userId] },
  ]);
  if (opts.log !== false) await appendRemovalLog({ v: 1, at: nowIso, kind: "account", id: userId });
}

/**
 * Applies one removal-log entry again (after a database restore), without
 * logging it a second time. The original removal time is kept. "absent":
 * the verdict or case is not in this database (made after the backup).
 * Account entries blank the user's data here; deleting the account itself
 * is up to the caller (scripts/originals.ts), which owns the auth tables.
 */
export async function replayRemoval(entry: RemovalLogEntry): Promise<"applied" | "absent"> {
  const at = new Date(entry.at);
  switch (entry.kind) {
    case "verdict": {
      const meta = await getVerdictMeta(entry.id);
      if (meta && meta.kind !== "legacy") {
        await removeVerdict(meta, entry.reason, at, { log: false });
        return "applied";
      }
      if (!meta && !(await getVerdict(entry.id))) return "absent";
      await operatorRemoveVerdict(entry.id, at, { log: false });
      return "applied";
    }
    case "case_side": {
      const row = await getCase(entry.id);
      if (!row) return "absent";
      const res = await removeCaseSide(row, entry.party, entry.reason, at, { log: false, ignoreBusy: true });
      if (!res.ok) throw new Error(`case ${entry.id} side ${entry.party}: ${res.code}`);
      return "applied";
    }
    case "account":
      await removeUserData(entry.id, at, { log: false });
      return "applied";
  }
}
