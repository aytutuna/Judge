import type { Client } from "@libsql/client";

/**
 * SQLite cannot change a CHECK, so the table is rebuilt from its own
 * definition with `pattern` replaced by `replacement`: every row copied by
 * column name, its indexes recreated, all in one atomic batch (an
 * interrupted run leaves the old table). A table whose definition no longer
 * matches `pattern` is left alone, so running it again changes nothing.
 * Returns whether it rebuilt.
 */
export async function rebuildTable(db: Client, table: string, pattern: RegExp, replacement: string): Promise<boolean> {
  const found = await db.execute({ sql: "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", args: [table] });
  const sql = String(found.rows[0]?.sql ?? "");
  if (!pattern.test(sql)) return false;
  const [columns, indexes] = await Promise.all([
    db.execute(`PRAGMA table_info(${table})`),
    db.execute({
      sql: "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL",
      args: [table],
    }),
  ]);
  const list = columns.rows.map((r) => `"${String(r.name)}"`).join(", ");
  const temp = `${table}_rebuild`;
  const create = sql
    .replace(pattern, replacement)
    .replace(/^CREATE TABLE\s+(IF NOT EXISTS\s+)?("?)\w+\2/i, `CREATE TABLE ${temp}`);
  await db.batch(
    [
      `DROP TABLE IF EXISTS ${temp}`,
      create,
      `INSERT INTO ${temp} (${list}) SELECT ${list} FROM ${table}`,
      `DROP TABLE ${table}`,
      `ALTER TABLE ${temp} RENAME TO ${table}`,
      ...indexes.rows.map((r) => String(r.sql)),
    ],
    "write",
  );
  return true;
}

/** `party IN ('a','b')` -> the four letters, for tables created when a case had two sides. */
export const PARTY_CHECK = /party\s+IN\s*\(\s*'a'\s*,\s*'b'\s*\)/i;
export const PARTY_CHECK_WIDE = "party IN ('a','b','c','d')";
