import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import type { D1Database } from "@cloudflare/workers-types/index";
import { d1Client } from "../lib/d1";

/** Just enough of D1's API, on a local SQLite file. */
function fakeD1(): D1Database {
  const dir = mkdtempSync(path.join(tmpdir(), "judge-d1-"));
  const db = createClient({ url: `file:${path.join(dir, "d1.db").replaceAll("\\", "/")}` });
  const prepare = (sql: string) => {
    const make = (args: unknown[]) => ({
      sql,
      args,
      bind: (...more: unknown[]) => make(more),
      all: async () => {
        const rs = await db.execute({ sql, args: args as never[] });
        return { results: rs.rows.map((r) => ({ ...r })), success: true, meta: { changes: rs.rowsAffected } };
      },
    });
    return make([]);
  };
  return {
    prepare,
    batch: async (stmts: { sql: string; args: unknown[] }[]) => {
      const rs = await db.batch(stmts.map((s) => ({ sql: s.sql, args: s.args as never[] })), "write");
      return rs.map((r) => ({ results: r.rows.map((x) => ({ ...x })), success: true, meta: { changes: r.rowsAffected } }));
    },
  } as unknown as D1Database;
}

describe("d1Client", () => {
  it("runs statements with positional arguments and reads rows by name", async () => {
    const db = d1Client(fakeD1());
    await db.execute("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER, flag INTEGER)");
    const ins = await db.execute({ sql: "INSERT INTO t (id, n, flag) VALUES (?, ?, ?)", args: ["a", BigInt(5), true] });
    expect(ins.rowsAffected).toBe(1);
    const rs = await db.execute({ sql: "SELECT id, n, flag FROM t WHERE id = ?", args: ["a"] });
    expect(rs.rows[0].id).toBe("a");
    expect(Number(rs.rows[0].n)).toBe(5);
    expect(Number(rs.rows[0].flag)).toBe(1);
  });

  it("returns one result per statement in a batch, with each statement's row count", async () => {
    const db = d1Client(fakeD1());
    await db.execute("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)");
    const rs = await db.batch(
      [
        { sql: "INSERT INTO t (id, n) VALUES (?, 1)", args: ["a"] },
        { sql: "INSERT OR IGNORE INTO t (id, n) VALUES (?, 2)", args: ["a"] },
        "UPDATE t SET n = 9 WHERE id = 'a'",
      ],
      "write",
    );
    expect(rs.map((r) => r.rowsAffected)).toEqual([1, 0, 1]);
  });

  it("answers an empty batch without calling D1", async () => {
    expect(await d1Client(fakeD1()).batch([], "write")).toEqual([]);
  });

  it("refuses named arguments", async () => {
    const db = d1Client(fakeD1());
    await expect(db.execute({ sql: "SELECT :a", args: { a: 1 } })).rejects.toThrow(/named/);
  });
});
