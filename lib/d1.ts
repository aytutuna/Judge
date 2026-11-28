import type { Client, InStatement, InValue, ResultSet, Row } from "@libsql/client";
import type { D1Database, D1PreparedStatement, D1Result } from "@cloudflare/workers-types/index";

/** The two calls the rest of the server makes on the database. libSQL's
 * client has them, and so does the D1 wrapper below. */
export type Db = Pick<Client, "execute" | "batch">;

type Stmt = InStatement | string;

/** `x IN ${IN_LIST}` with one JSON array argument (jsonList). D1 allows 100
 * bound parameters per statement, so lists of ids go in as a single one. */
export const IN_LIST = "(SELECT value FROM json_each(?))";
export const jsonList = (values: readonly string[]): string => JSON.stringify(values);

function value(v: InValue): string | number | null {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") return Number(v);
  return v as string | number | null;
}

function prepare(d1: D1Database, stmt: Stmt): D1PreparedStatement {
  const { sql, args } = typeof stmt === "string" ? { sql: stmt, args: [] } : stmt;
  if (args && !Array.isArray(args)) throw new Error("named arguments are not supported on D1");
  const bound = d1.prepare(sql);
  return args?.length ? bound.bind(...(args as InValue[]).map(value)) : bound;
}

function resultSet(r: D1Result<unknown>): ResultSet {
  const rows = r.results as Row[];
  return {
    columns: rows[0] ? Object.keys(rows[0]) : [],
    columnTypes: [],
    rows,
    rowsAffected: r.meta?.changes ?? 0,
    lastInsertRowid: r.meta?.last_row_id === undefined ? undefined : BigInt(r.meta.last_row_id),
    toJSON: () => ({ rows, rowsAffected: r.meta?.changes ?? 0 }),
  };
}

/** D1 errors that are only passing trouble (the object restarted, was busy or overloaded). */
const TRANSIENT = /network connection lost|reset because its code was updated|storage operation exceeded timeout|overloaded|temporarily unavailable|timed out/i;
/** Errors from before the statement ran, so even a write may run again. The
 * others are retried only for reads: the write may already have committed. */
const NOT_RUN = /reset because its code was updated|overloaded|temporarily unavailable/i;
const TRIES = 4;

const isRead = (stmt: Stmt) => /^\s*(select|with|pragma)\b/i.test(typeof stmt === "string" ? stmt : stmt.sql);

/** Runs `run` again after a transient D1 error, as the Node server retried SQLITE_BUSY. */
async function retrying<T>(reads: boolean, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const again = reads ? TRANSIENT.test(message) : NOT_RUN.test(message);
      if (!again || attempt >= TRIES) throw e;
      await new Promise((r) => setTimeout(r, 50 * 2 ** attempt + Math.random() * 50));
    }
  }
}

/** libSQL-shaped access to a D1 database. A batch is one transaction on both. */
export function d1Client(d1: D1Database): Db {
  return {
    async execute(stmt: Stmt) {
      return retrying(isRead(stmt), async () => resultSet(await prepare(d1, stmt).all()));
    },
    async batch(stmts: Array<Stmt | [string, InValue[]?]>) {
      if (!stmts.length) return [];
      const prepared = stmts.map((s) => prepare(d1, Array.isArray(s) ? { sql: s[0], args: s[1] ?? [] } : s));
      const reads = stmts.every((s) => isRead(Array.isArray(s) ? s[0] : s));
      return retrying(reads, async () => (await d1.batch(prepared)).map(resultSet));
    },
  } as Db;
}
