/**
 * Whether a verdict's public link is closed. Kept apart from the rest of
 * lib/originals, with nothing but the database client, so the proxy can
 * load it cheaply. Server only.
 */

import { getDb } from "@/lib/db";

function missingTable(e: unknown): boolean {
  return /no such (table|column)/i.test(e instanceof Error ? e.message : String(e));
}

async function closed(id: string): Promise<boolean> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT m.removed_at AS removed,
            (SELECT c.removed_at FROM cases c WHERE c.id = m.case_id) AS case_removed
          FROM verdict_meta m WHERE m.verdict_id = ?`,
    args: [id],
  });
  const row = rs.rows[0];
  return Boolean(row && (row.removed != null || row.case_removed != null));
}

/** A final under-13 block (lib/age.ts): the account's share pages are closed
 * at once, before its data goes 7 days later (lib/minor-deletion.ts). */
const FINAL_BLOCK = "u.age_blocked_at IS NOT NULL AND u.age_block_final IS NOT NULL";

/** True when the verdict was written by an account with a final block, or
 * belongs to a case that account started or has a written side in. */
export async function onBlockedAccount(id: string): Promise<boolean> {
  const caseId = "(SELECT case_id FROM case_verdicts WHERE verdict_id = ?1)";
  const written = (party: string) => `EXISTS (SELECT 1 FROM case_sides s WHERE s.case_id = ${caseId} AND s.party = ${party})`;
  try {
    const db = await getDb();
    const rs = await db.execute({
      sql: `SELECT EXISTS (SELECT 1 FROM verdict_meta m JOIN "user" u ON u.id = m.owner_user_id
                           WHERE m.verdict_id = ?1 AND ${FINAL_BLOCK})
              OR EXISTS (SELECT 1 FROM "user" u WHERE ${FINAL_BLOCK} AND u.id IN (
                   SELECT owner_id FROM cases WHERE id = ${caseId}
                   UNION SELECT respondent_user_id FROM cases WHERE id = ${caseId} AND ${written("'b'")}
                   UNION SELECT user_id FROM case_invites i WHERE case_id = ${caseId} AND ${written("i.party")})) AS blocked`,
      args: [id],
    });
    return Number(rs.rows[0]?.blocked) === 1;
  } catch (e) {
    if (missingTable(e)) return false;
    throw e;
  }
}

/** The verdict a round of added context was added to; null for any other id. */
export async function roundRoot(id: string): Promise<string | null> {
  const db = await getDb();
  try {
    const rs = await db.execute({ sql: "SELECT verdict_id FROM verdict_appeals WHERE id = ?", args: [id] });
    return rs.rows[0] ? String(rs.rows[0].verdict_id) : null;
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

/** True when the verdict (or the case it belongs to) was removed, or, for a
 * round's verdict, the verdict the round was added to. A database without
 * the originals tables yet answers false. A final under-13 block on the
 * writer's account closes it as well. */
export async function verdictRemoved(id: string): Promise<boolean> {
  try {
    if (await closed(id)) return true;
  } catch (e) {
    if (missingTable(e)) return false;
    throw e;
  }
  const root = await roundRoot(id);
  if (root !== null && (await closed(root))) return true;
  return (await onBlockedAccount(id)) || (root !== null && (await onBlockedAccount(root)));
}
