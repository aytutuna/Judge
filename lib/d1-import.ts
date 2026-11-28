/**
 * Copying rows from the old SQLite database into D1, for the cutover
 * (scripts/d1-copy.ts posts them to /api/internal/import, which is only
 * switched on with IMPORT_ENABLED=1). Values are bound, never written into
 * the SQL, so rows over D1's 100 KB statement limit (sealed originals, long
 * verdicts) go through, up to its 2 MB row limit.
 */

import type { Db } from "./d1";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const MAX_ROWS_PER_REQUEST = 100;

export type ImportBatch = { table: string; columns: string[]; rows: (string | number | null)[][] };

export function parseBatch(body: unknown): ImportBatch | null {
  const b = body as Partial<ImportBatch> | null;
  if (!b || typeof b.table !== "string" || !IDENT.test(b.table)) return null;
  if (!Array.isArray(b.columns) || !b.columns.length || !b.columns.every((c) => typeof c === "string" && IDENT.test(c))) return null;
  if (b.columns.length > 100) return null;
  if (!Array.isArray(b.rows) || b.rows.length > MAX_ROWS_PER_REQUEST) return null;
  const cell = (v: unknown) => v === null || typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
  const width = b.columns.length;
  if (!b.rows.every((r) => Array.isArray(r) && r.length === width && r.every(cell))) return null;
  return { table: b.table, columns: b.columns, rows: b.rows };
}

/** Inserts the rows (replacing a row with the same key) in one atomic batch.
 * The table and its columns must exist. Returns how many rows were written. */
export async function importBatch(db: Db, batch: ImportBatch): Promise<number> {
  const info = await db.execute(`PRAGMA table_info("${batch.table}")`);
  const known = new Set(info.rows.map((r) => String(r.name)));
  if (!known.size) throw new Error(`no table ${batch.table}`);
  const unknown = batch.columns.find((c) => !known.has(c));
  if (unknown) throw new Error(`no column ${batch.table}.${unknown}`);
  if (!batch.rows.length) return 0;
  const cols = batch.columns.map((c) => `"${c}"`).join(", ");
  const marks = batch.columns.map(() => "?").join(", ");
  const sql = `INSERT OR REPLACE INTO "${batch.table}" (${cols}) VALUES (${marks})`;
  await db.batch(batch.rows.map((args) => ({ sql, args })), "write");
  return batch.rows.length;
}

/** Row counts of every table, to compare with the source after a copy. */
export async function tableCounts(db: Db): Promise<Record<string, number>> {
  const tables = await db.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  );
  const counts: Record<string, number> = {};
  for (const row of tables.rows) {
    const name = String(row.name);
    counts[name] = Number((await db.execute(`SELECT COUNT(*) AS n FROM "${name}"`)).rows[0].n);
  }
  return counts;
}
