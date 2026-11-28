/**
 * The database as SQL text, read through the D1 binding page by page, so the
 * nightly backup needs no API token (a D1 token would reach every D1 database
 * in the account). Schema first, then each table's rows by rowid, tables with
 * the ones other tables point at first, so the file loads into an empty
 * database in order. The pages are separate reads, not one snapshot: D1's
 * Time Travel is the point-in-time copy, this one is for leaving the platform.
 * A D1 invocation may make 1,000 queries, so a database over about 400,000 rows
 * stops with an error (and an alert) instead of a short copy.
 */

import type { Db } from "./d1";

const PAGE_ROWS = 400;
const MAX_QUERIES = 900;
const LIKE_SKIP = "name NOT LIKE 'sqlite!_%' ESCAPE '!' AND name NOT LIKE '!_cf!_%' ESCAPE '!'";

/** A SQL literal for a value D1 returns (text, number or null). */
export function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  const s = String(v);
  // A NUL cannot sit in a quoted literal everywhere; go through hex.
  if (s.includes("\u0000")) return `CAST(X'${Buffer.from(s, "utf8").toString("hex")}' AS TEXT)`;
  return `'${s.replaceAll("'", "''")}'`;
}

/** Tables with the ones they reference first. */
async function tableOrder(db: Db, names: string[]): Promise<string[]> {
  const needs = new Map<string, string[]>();
  for (const name of names) {
    const fks = await db.execute(`PRAGMA foreign_key_list("${name}")`);
    needs.set(name, fks.rows.map((r) => String(r.table)).filter((t) => t !== name && names.includes(t)));
  }
  const order: string[] = [];
  while (order.length < names.length) {
    const next = names.find((n) => !order.includes(n) && needs.get(n)!.every((t) => order.includes(t)));
    if (!next) throw new Error("foreign keys form a cycle");
    order.push(next);
  }
  return order;
}

/** The dump, as chunks of SQL text. */
export async function* dumpSql(db: Db): AsyncGenerator<string> {
  let queries = 0;
  const run = async (sql: string, args: (string | number)[] = []) => {
    if (++queries > MAX_QUERIES) throw new Error("the database is too large to copy through the binding in one run");
    return db.execute({ sql, args });
  };
  const master = await run(
    `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND ${LIKE_SKIP}
     ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`,
  );
  const tables = master.rows.filter((r) => r.type === "table").map((r) => String(r.name));
  for (const r of master.rows) yield `${String(r.sql)};\n`;
  for (const table of await tableOrder(db, tables)) {
    let after = -1;
    for (;;) {
      const page = await run(`SELECT rowid AS _rowid_, * FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE_ROWS}`, [after]);
      if (!page.rows.length) break;
      const columns = Object.keys(page.rows[0]).filter((c) => c !== "_rowid_");
      const names = columns.map((c) => `"${c}"`).join(", ");
      let out = "";
      for (const row of page.rows) out += `INSERT INTO "${table}" (${names}) VALUES (${columns.map((c) => literal(row[c])).join(", ")});\n`;
      yield out;
      after = Number(page.rows[page.rows.length - 1]._rowid_);
      if (page.rows.length < PAGE_ROWS) break;
    }
  }
}

/** The dump as a byte stream, read as it is pulled. */
export function dumpStream(db: Db): ReadableStream<Uint8Array> {
  const chunks = dumpSql(db);
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}
