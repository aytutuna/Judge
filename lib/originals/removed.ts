/**
 * Whether a verdict's public link is closed. Kept apart from the rest of
 * lib/originals, with nothing but the database client, so the proxy can
 * load it cheaply. Server only.
 */

import { getDb } from "@/lib/db";

/** True when the verdict (or the case it belongs to) was removed. A
 * database without the originals tables yet answers false. */
export async function verdictRemoved(id: string): Promise<boolean> {
  const db = await getDb();
  try {
    const rs = await db.execute({
      sql: `SELECT m.removed_at AS removed,
              (SELECT c.removed_at FROM cases c WHERE c.id = m.case_id) AS case_removed
            FROM verdict_meta m WHERE m.verdict_id = ?`,
      args: [id],
    });
    const row = rs.rows[0];
    return Boolean(row && (row.removed != null || row.case_removed != null));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/no such (table|column)/i.test(message)) return false;
    throw e;
  }
}
