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
