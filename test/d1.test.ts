import { describe, expect, it } from "vitest";
import { d1Client } from "../lib/d1";
import { D1_MAX_VARIABLES, fakeD1 } from "./helpers/fake-d1";

describe("d1Client", () => {
  it("runs statements with positional arguments and reads rows by name", async () => {
    const db = d1Client(await fakeD1());
    await db.execute("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER, flag INTEGER)");
    const ins = await db.execute({ sql: "INSERT INTO t (id, n, flag) VALUES (?, ?, ?)", args: ["a", BigInt(5), true] });
    expect(ins.rowsAffected).toBe(1);
    const rs = await db.execute({ sql: "SELECT id, n, flag FROM t WHERE id = ?", args: ["a"] });
    expect(rs.rows[0].id).toBe("a");
    expect(Number(rs.rows[0].n)).toBe(5);
    expect(Number(rs.rows[0].flag)).toBe(1);
  });

  it("returns one result per statement in a batch, with each statement's row count", async () => {
    const db = d1Client(await fakeD1());
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
    expect(await d1Client(await fakeD1()).batch([], "write")).toEqual([]);
  });

  it("refuses named arguments", async () => {
    const db = d1Client(await fakeD1());
    await expect(db.execute({ sql: "SELECT :a", args: { a: 1 } })).rejects.toThrow(/named/);
  });

  it("the fake refuses what D1 refuses: more than 100 bound parameters", async () => {
    const db = d1Client(await fakeD1());
    const args = Array.from({ length: D1_MAX_VARIABLES + 1 }, () => 1);
    await expect(db.execute({ sql: `SELECT ${args.map(() => "?").join("+")}`, args })).rejects.toThrow(/too many/);
  });
});

describe("d1Client retries", () => {
  /** A D1 whose first `fails` calls throw `message`. */
  function flaky(message: string, fails: number) {
    let calls = 0;
    const base = fakeD1();
    return {
      get calls() {
        return calls;
      },
      db: base.then((real) => ({
        prepare: (sql: string) => {
          const stmt = real.prepare(sql);
          return { ...stmt, bind: (...a: unknown[]) => ({ all: async () => { if (++calls <= fails) throw new Error(message); return real.prepare(sql).bind(...a).all(); } }) };
        },
        batch: async (stmts: never) => {
          if (++calls <= fails) throw new Error(message);
          return real.batch(stmts);
        },
      })),
    };
  }

  it("runs a read again after a passing error", async () => {
    const f = flaky("D1_ERROR: Network connection lost", 2);
    const db = d1Client((await f.db) as never);
    expect((await db.execute({ sql: "SELECT 1 AS one WHERE ? = 1", args: [1] })).rows[0].one).toBe(1);
    expect(f.calls).toBe(3);
  });

  it("does not run a write again when it may already have committed", async () => {
    const f = flaky("D1_ERROR: Network connection lost", 1);
    const db = d1Client((await f.db) as never);
    await expect(db.batch([{ sql: "CREATE TABLE t (id TEXT)", args: [] }], "write")).rejects.toThrow(/lost/);
    expect(f.calls).toBe(1);
  });

  it("runs a write again when D1 says it did not run it", async () => {
    const f = flaky("D1_ERROR: D1 DB is overloaded", 1);
    const db = d1Client((await f.db) as never);
    await db.batch([{ sql: "CREATE TABLE t (id TEXT)", args: [] }], "write");
    expect(f.calls).toBe(2);
  });
});
