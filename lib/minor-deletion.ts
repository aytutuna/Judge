/**
 * What follows a final under-13 block (lib/age.ts). The share pages close at
 * once (lib/originals/removed.ts); 7 days after the block the daily cleanup
 * deletes the account the way the owner's own deletion does, after first
 * wiping the text it wrote: its one-sided verdicts and their rounds, its
 * side, appeals and evidence in cases, and the verdicts of a case nobody else
 * wrote in. The rows stay, as in any removal. Other people's sides of a
 * shared case are theirs and are not touched. The scrambled email that keeps
 * the block (welcome_claims) and the consent ledger rows the law needs stay.
 * Server only.
 */

import type { InStatement } from "@libsql/client";
import { keepBlock } from "@/lib/age";
import { forgetUser } from "@/lib/analytics/db";
import { ensureCaseTables } from "@/lib/cases/db";
import { getDb } from "@/lib/db";
import { deleteUserEntitlements, entitlementWriteBatch } from "@/lib/entitlements";
import { blankRoundsStatement, eraseVerdictStatements } from "@/lib/erasure";
import { ensureOriginalsTables, userBackfillStatements } from "@/lib/originals/db";
import { removeUserData } from "@/lib/originals/removal";
import { revokeSignInTokens } from "@/lib/signin-tokens";

export const BLOCK_GRACE_MS = 7 * 24 * 60 * 60_000;

/** The (case, side) pairs the account wrote or holds. */
const MINE = `SELECT id AS case_id, 'a' AS party FROM cases WHERE owner_id = ?1
  UNION SELECT id, 'b' FROM cases WHERE respondent_user_id = ?1
  UNION SELECT case_id, party FROM case_invites WHERE user_id = ?1`;

async function wipeText(userId: string, nowIso: string): Promise<void> {
  await entitlementWriteBatch(userBackfillStatements(userId, nowIso));
  const db = await getDb();
  const [own, alone] = await Promise.all([
    db.execute({ sql: "SELECT verdict_id FROM verdict_meta WHERE owner_user_id = ? AND kind <> 'case'", args: [userId] }),
    db.execute({
      sql: `SELECT cv.verdict_id FROM case_verdicts cv
            WHERE cv.case_id IN (SELECT case_id FROM (${MINE}))
              AND NOT EXISTS (SELECT 1 FROM case_sides s WHERE s.case_id = cv.case_id
                              AND (s.case_id, s.party) NOT IN (${MINE}))`,
      args: [userId],
    }),
  ]);
  const roots = own.rows.map((r) => String(r.verdict_id));
  const rounds = roots.length
    ? await db.execute({ sql: `SELECT id FROM verdict_appeals WHERE verdict_id IN (${roots.map(() => "?").join(", ")})`, args: roots })
    : { rows: [] };
  const verdicts = [...roots, ...rounds.rows.map((r) => String(r.id)), ...alone.rows.map((r) => String(r.verdict_id))];
  const mine = (table: string, column: string): InStatement => ({
    sql: `UPDATE ${table} SET ${column} = '' WHERE (case_id, party) IN (${MINE})`,
    args: [userId],
  });
  await entitlementWriteBatch([
    ...(verdicts.length ? await eraseVerdictStatements(verdicts, nowIso) : []),
    ...(roots.length ? [blankRoundsStatement(roots, nowIso)] : []),
    mine("case_sides", "text"),
    mine("case_appeals", "text"),
    mine("case_evidence", "transcript"),
  ]);
}

async function deleteOne(userId: string, email: string, now: Date): Promise<void> {
  const { deleteAuthUser, welcomeClaim } = await import("@/lib/auth");
  // Text first: removeUserData cuts the account's ownership of it loose.
  await wipeText(userId, now.toISOString());
  const claim = welcomeClaim(email);
  if (claim) await keepBlock(claim, true, now);
  const signInTokens = await revokeSignInTokens(userId);
  await removeUserData(userId, now, { signInTokens });
  await deleteUserEntitlements(userId);
  await forgetUser(userId);
  await deleteAuthUser(userId);
}

/** Deletes the accounts whose final block is 7 days old. A failure on one
 * account is logged and the next one still runs; it is tried again the next
 * day. Returns how many were deleted. */
export async function deleteBlockedAccounts(now: Date = new Date()): Promise<number> {
  await ensureOriginalsTables();
  await ensureCaseTables();
  const db = await getDb();
  let due;
  try {
    due = await db.execute({
      sql: `SELECT id, email FROM "user" WHERE age_blocked_at IS NOT NULL AND age_block_final IS NOT NULL AND age_blocked_at <= ?`,
      args: [new Date(now.getTime() - BLOCK_GRACE_MS).toISOString()],
    });
  } catch (e) {
    // Startup cleanup can run before the sign-in migration made the table.
    if (/no such (column|table)/i.test(e instanceof Error ? e.message : String(e))) return 0;
    throw e;
  }
  let deleted = 0;
  for (const r of due.rows) {
    try {
      await deleteOne(String(r.id), String(r.email), now);
      deleted += 1;
    } catch (e) {
      console.error("[cleanup] deleting a blocked account failed:", e instanceof Error ? e.message : String(e));
    }
  }
  return deleted;
}
