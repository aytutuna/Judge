import type { Client, InStatement, InValue, ResultSet, Row } from "@libsql/client";
import type { D1Database, D1PreparedStatement, D1Result } from "@cloudflare/workers-types/index";

/** The two calls the rest of the server makes on the database. libSQL's
 * client has them, and so does the D1 wrapper below. */
export type Db = Pick<Client, "execute" | "batch">;

type Stmt = InStatement | string;

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

/** libSQL-shaped access to a D1 database. A batch is one transaction on both. */
export function d1Client(d1: D1Database): Db {
  return {
    async execute(stmt: Stmt) {
      return resultSet(await prepare(d1, stmt).all());
    },
    async batch(stmts: Array<Stmt | [string, InValue[]?]>) {
      if (!stmts.length) return [];
      const prepared = stmts.map((s) => prepare(d1, Array.isArray(s) ? { sql: s[0], args: s[1] ?? [] } : s));
      return (await d1.batch(prepared)).map(resultSet);
    },
  } as Db;
}
