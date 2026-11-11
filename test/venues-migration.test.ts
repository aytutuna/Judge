import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterAll, describe, expect, it } from "vitest";

/** A database from before venues: the verdicts table has no venue column. It
 * must gain one without touching a stored verdict, and be safe to run again. */

const dir = mkdtempSync(path.join(tmpdir(), "verdict-venues-"));
const url = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.DATABASE_URL = url;

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

describe("verdicts.venue on an old table", () => {
  it("adds the column, keeps the rows and stores a venue for new ones", async () => {
    const old = createClient({ url });
    await old.execute(`CREATE TABLE verdicts (
      id TEXT PRIMARY KEY,
      input TEXT NOT NULL,
      framework TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await old.execute(`INSERT INTO verdicts (id, input, framework, result) VALUES ('old1', 'in', 'fw', '{"kept":true}')`);
    old.close();

    const { getDb, saveVerdict } = await import("../lib/db");
    const db = await getDb();
    const cols = (await db.execute("PRAGMA table_info(verdicts)")).rows.map((r) => String(r.name));
    expect(cols).toContain("venue");
    const kept = (await db.execute("SELECT * FROM verdicts WHERE id = 'old1'")).rows[0];
    expect(kept).toMatchObject({ input: "in", result: '{"kept":true}', venue: null });

    await saveVerdict({ id: "new1", input: "in", result: {} as never, venue: "ice" });
    await saveVerdict({ id: "new2", input: "in", result: {} as never });
    const rows = (await db.execute("SELECT id, venue FROM verdicts WHERE id LIKE 'new%' ORDER BY id")).rows;
    expect(rows.map((r) => [r.id, r.venue])).toEqual([["new1", "ice"], ["new2", null]]);

    const g = globalThis as unknown as { __verdictLibsqlReady?: unknown };
    g.__verdictLibsqlReady = undefined;
    await getDb();
    expect((await db.execute("SELECT count(*) AS n FROM verdicts")).rows[0].n).toBe(3);
  });
});
