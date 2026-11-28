import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import type { D1Database } from "@cloudflare/workers-types/index";

/** D1's limit on bound parameters in one statement. */
export const D1_MAX_VARIABLES = 100;

/** Just enough of D1's API on a local SQLite file, refusing what D1 refuses:
 * more than 100 bound parameters in a statement. With `schema`, the D1
 * migration is applied first. */
export async function fakeD1(opts: { schema?: boolean } = {}): Promise<D1Database> {
  const dir = mkdtempSync(path.join(tmpdir(), "judge-d1-"));
  const db = createClient({ url: `file:${path.join(dir, "d1.db").replaceAll("\\", "/")}` });
  if (opts.schema) await db.executeMultiple(readFileSync(new URL("../../migrations/0001_schema.sql", import.meta.url), "utf8"));
  const make = (sql: string, args: unknown[]) => ({
    sql,
    args,
    bind: (...more: unknown[]) => {
      if (more.length > D1_MAX_VARIABLES) throw new Error(`D1_ERROR: too many SQL variables (${more.length})`);
      return make(sql, more);
    },
    all: async () => {
      const rs = await db.execute({ sql, args: args as never[] });
      return { results: rs.rows.map((r) => ({ ...r })), success: true, meta: { changes: rs.rowsAffected } };
    },
  });
  return {
    prepare: (sql: string) => make(sql, []),
    batch: async (stmts: { sql: string; args: unknown[] }[]) => {
      const rs = await db.batch(stmts.map((s) => ({ sql: s.sql, args: s.args as never[] })), "write");
      return rs.map((r) => ({ results: r.rows.map((x) => ({ ...x })), success: true, meta: { changes: r.rowsAffected } }));
    },
  } as unknown as D1Database;
}
