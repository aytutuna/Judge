import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/** A database whose case_seats was made before seen_at existed: the column
 * is added on start-up, the old seat keeps working, and seating and typing
 * work on it. */

const dir = mkdtempSync(path.join(tmpdir(), "verdict-seats-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { getDb } = await import("../lib/db");
const { ensureCaseTables, getSeats } = await import("../lib/cases/db");
const { recordTyping, touchSeat } = await import("../lib/cases/seats");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

describe("case_seats from before seen_at", () => {
  it("gains the column, keeps its rows and takes touches and heartbeats", async () => {
    const db = await getDb();
    await db.execute(`CREATE TABLE case_seats (
      case_id    TEXT NOT NULL,
      party      TEXT NOT NULL CHECK (party IN ('b','c','d')),
      nonce      TEXT NOT NULL,
      user_id    TEXT,
      opened_at  TEXT NOT NULL,
      typing_at  TEXT,
      PRIMARY KEY (case_id, party)
    )`);
    await db.execute({
      sql: "INSERT INTO case_seats (case_id, party, nonce, opened_at) VALUES ('c1', 'b', 'n1', '2026-11-01T10:00:00.000Z')",
      args: [],
    });

    await ensureCaseTables();
    await ensureCaseTables();
    const cols = (await db.execute("PRAGMA table_info(case_seats)")).rows.map((r) => String(r.name));
    expect(cols).toContain("seen_at");

    const before = (await getSeats("c1"))[0];
    expect([before.nonce, before.seenAt]).toEqual(["n1", null]);

    const now = new Date("2026-11-02T10:00:00.000Z");
    await touchSeat("c1", "b", now);
    expect((await getSeats("c1"))[0].seenAt).toBe(now.toISOString());
    await recordTyping("c1", "b", new Date("2026-11-02T10:05:00.000Z"));
    const after = (await getSeats("c1"))[0];
    expect([after.typingAt, after.seenAt]).toEqual(["2026-11-02T10:05:00.000Z", "2026-11-02T10:05:00.000Z"]);
  });
});
