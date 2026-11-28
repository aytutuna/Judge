import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { importBatch, MAX_ROWS_PER_REQUEST, parseBatch, tableCounts, wipeAll } from "../lib/d1-import";

function scratchDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "judge-import-"));
  return createClient({ url: `file:${path.join(dir, "i.db").replaceAll("\\", "/")}` });
}

describe("parseBatch", () => {
  it("accepts a table, its columns and rows of the same width", () => {
    expect(parseBatch({ table: "verdicts", columns: ["id", "input"], rows: [["a", "b"], ["c", null]] })).not.toBeNull();
  });

  it("refuses odd identifiers, ragged rows, non-values and oversized batches", () => {
    expect(parseBatch({ table: "x; DROP TABLE y", columns: ["id"], rows: [] })).toBeNull();
    expect(parseBatch({ table: "t", columns: ['id"'], rows: [] })).toBeNull();
    expect(parseBatch({ table: "t", columns: ["a", "b"], rows: [["x"]] })).toBeNull();
    expect(parseBatch({ table: "t", columns: ["a"], rows: [[{ no: 1 }]] })).toBeNull();
    expect(parseBatch({ table: "t", columns: ["a"], rows: [[Number.NaN]] })).toBeNull();
    expect(parseBatch({ table: "t", columns: ["a"], rows: Array.from({ length: MAX_ROWS_PER_REQUEST + 1 }, () => ["x"]) })).toBeNull();
    expect(parseBatch(null)).toBeNull();
  });
});

describe("importBatch", () => {
  it("writes rows, replaces one with the same key, and counts every table", async () => {
    const db = scratchDb();
    await db.execute("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT)");
    await db.execute("CREATE TABLE empty_one (id TEXT PRIMARY KEY)");
    const batch = { table: "t", columns: ["id", "v"], rows: [["a", "1"], ["b", "x".repeat(300_000)]] };
    expect(await importBatch(db, batch)).toBe(2);
    expect(await importBatch(db, { ...batch, rows: [["a", "2"]] })).toBe(1);
    expect((await db.execute("SELECT v FROM t WHERE id = 'a'")).rows[0].v).toBe("2");
    expect(await tableCounts(db)).toEqual({ empty_one: 0, t: 2 });
  });

  it("refuses a table or column the schema does not have", async () => {
    const db = scratchDb();
    await db.execute("CREATE TABLE t (id TEXT PRIMARY KEY)");
    await expect(importBatch(db, { table: "nope", columns: ["id"], rows: [["a"]] })).rejects.toThrow(/no table/);
    await expect(importBatch(db, { table: "t", columns: ["id", "zzz"], rows: [["a", "b"]] })).rejects.toThrow(/no column/);
  });

  it("empties every table for a rehearsal copy", async () => {
    const db = scratch();
    await db.execute("CREATE TABLE a (id TEXT PRIMARY KEY)");
    await db.execute("CREATE TABLE b (id TEXT PRIMARY KEY, a_id TEXT REFERENCES a(id))");
    await db.execute("INSERT INTO a VALUES ('1')");
    await db.execute("INSERT INTO b VALUES ('x', '1')");
    expect(await wipeAll(db)).toBe(2);
    expect(await tableCounts(db)).toEqual({ a: 0, b: 0 });
  });
});
