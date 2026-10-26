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
 * the originals tables yet answers false. */
export async function verdictRemoved(id: string): Promise<boolean> {
  try {
    if (await closed(id)) return true;
  } catch (e) {
    if (missingTable(e)) return false;
    throw e;
  }
  const root = await roundRoot(id);
  return root !== null && (await closed(root));
}
