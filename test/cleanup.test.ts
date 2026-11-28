import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/** The daily clean-up: expired sign-in code rows, old consent records, old removal-log entries. */

const dir = mkdtempSync(path.join(tmpdir(), "verdict-cleanup-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
const LOG = path.join(dir, "removals.log");
process.env.REMOVAL_LOG = LOG;

const { runCleanup } = await import("../lib/cleanup");
const { getDb } = await import("../lib/db");
// The real table comes from Better Auth, which this test does not load.
await (await getDb()).execute('CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, age_confirmed_at TEXT, age_blocked_at TEXT, age_block_final TEXT, age_block_final_at TEXT, age_dob TEXT, age_dob_at TEXT, age_signal TEXT, age_signal_at TEXT, age_country TEXT, age_quebec TEXT, age_region_lifted_at TEXT, age_parent TEXT)');
const { removeUserData } = await import("../lib/originals/removal");
const { ensureOriginalsTables } = await import("../lib/originals/db");
const { appendRemovalLog, pruneRemovalLog } = await import("../lib/originals/removal-log");
const { recordConsent, setRating } = await import("../lib/feedback/db");
const { backdateUnlinked } = await import("./ledger-backdate");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const DAY = 24 * 60 * 60_000;
const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

async function all(sql: string, args: string[] = []) {
  const db = await getDb();
  return (await db.execute({ sql, args })).rows.map((r) => ({ ...r }));
}

describe("expired sign-in codes", () => {
  it("does nothing, and does not fail, before any sign-in created the table", async () => {
    expect(await runCleanup(NOW)).toEqual({ verification: 0, ledger: 0, removalLog: 0, adultDobs: 0, attests: 0, blocked: 0, parentless: 0, parentRecords: 0 });
  });

  it("deletes the rows past their expiry and keeps the live ones", async () => {
    const db = await getDb();
    await db.execute(
      `CREATE TABLE IF NOT EXISTS "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null)`,
    );
    const row = (id: string, expires: string) => ({
      sql: 'INSERT INTO "verification" (id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)',
      args: [id, `sign-in-otp-${id}@verdict.local`, "123456:0", expires, ago(1), ago(1)],
    });
    await db.batch([row("old1", ago(2)), row("old2", ago(0.01)), row("live", new Date(NOW.getTime() + 5 * 60_000).toISOString())], "write");
    expect((await runCleanup(NOW)).verification).toBe(2);
    expect((await all('SELECT id FROM "verification"')).map((r) => r.id)).toEqual(["live"]);
    expect((await runCleanup(NOW)).verification).toBe(0);
  });
});

describe("consent records after an account is deleted", () => {
  async function member(id: string, deletedDaysAgo: number | null) {
    await ensureOriginalsTables();
    await recordConsent(id, { choice: "on", source: "card", wordingKey: "consent.cardBody", wordingText: "w", lang: "en", platform: "web" });
    await setRating(`v-${id}`, id, "up");
    if (deletedDaysAgo === null) return;
    await removeUserData(id, new Date(), { log: false });
    await backdateUnlinked(ago(deletedDaysAgo));
  }

  it("keeps them for six years after the deletion, then deletes them", async () => {
    await member("u-live", null);
    await member("u-recent", 365);
    await member("u-edge", 6 * 365 - 30);
    await member("u-old", 6 * 365 + 60);
    const before = Number((await all("SELECT count(*) AS n FROM consent_ledger"))[0].n);

    expect((await runCleanup(NOW)).ledger).toBe(1);
    expect(Number((await all("SELECT count(*) AS n FROM consent_ledger"))[0].n)).toBe(before - 1);
    expect(await all("SELECT 1 FROM consent_ledger WHERE user_id = 'u-live'")).toHaveLength(1);
    expect(await all("SELECT 1 FROM consent_ledger WHERE unlinked_at < ?", [ago(6 * 365)])).toHaveLength(0);
    // The ratings are not the ledger: they stay.
    expect(await all("SELECT 1 FROM verdict_ratings WHERE user_id LIKE 'deleted:%'")).toHaveLength(3);
    expect((await runCleanup(NOW)).ledger).toBe(0);
  });
});

describe("the removal log", () => {
  const entry = (id: string, at: string) => JSON.stringify({ v: 1, at, kind: "verdict", id, reason: "owner" });

  it("drops entries older than 90 days and keeps the rest, unreadable lines included", async () => {
    writeFileSync(LOG, [entry("old", ago(91)), entry("fresh", ago(89)), "not json", entry("new", ago(1)), ""].join("\n"));
    expect(await pruneRemovalLog(NOW)).toBe(1);
    const lines = readFileSync(LOG, "utf8").trim().split("\n");
    expect(lines.map((l) => (l.startsWith("{") ? JSON.parse(l).id : l))).toEqual(["fresh", "not json", "new"]);
    expect(await pruneRemovalLog(NOW)).toBe(0);
  });

  it("reads as nothing to do when there is no file, and loses no append made while it rewrites", async () => {
    rmSync(LOG, { force: true });
    expect(await pruneRemovalLog(NOW)).toBe(0);
    writeFileSync(LOG, `${entry("old", ago(200))}\n${entry("keep", ago(2))}\n`);
    await Promise.all([
      pruneRemovalLog(NOW),
      ...Array.from({ length: 20 }, (_, i) => appendRemovalLog({ v: 1, at: ago(0), kind: "verdict", id: `late${i}`, reason: "owner" })),
    ]);
    const ids = readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l).id as string);
    expect(ids).not.toContain("old");
    expect(ids).toContain("keep");
    expect(ids.filter((i) => i.startsWith("late"))).toHaveLength(20);
  });
});

describe("answer ticks of signed-out writers", () => {
  const tick = async (caseId: string, party: string, years: number) => {
    const at = new Date(NOW);
    at.setUTCFullYear(at.getUTCFullYear() - years);
    if (caseId === "t-edge") at.setTime(at.getTime() + DAY);
    await (await getDb()).execute({
      sql: "INSERT INTO case_side_attest (case_id, party, adult_confirmed_at, sensitive_agreed_at) VALUES (?, ?, ?, ?)",
      args: [caseId, party, at.toISOString(), at.toISOString()],
    });
  };

  it("are deleted six years after they were given, not before", async () => {
    await runCleanup(NOW);
    await tick("t-old", "b", 7);
    await tick("t-edge", "b", 6);
    await tick("t-new", "b", 0);
    expect((await runCleanup(NOW)).attests).toBe(1);
    expect((await all("SELECT case_id FROM case_side_attest ORDER BY case_id")).map((r) => r.case_id)).toEqual(["t-edge", "t-new"]);
    expect((await runCleanup(NOW)).attests).toBe(0);
  });
});

describe("clearing dates of birth before the sign-in migration", () => {
  it("skips quietly when the user table has no such column yet", async () => {
    const db = await getDb();
    await db.execute('DROP TABLE "user"');
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await runCleanup(NOW)).adultDobs).toBe(0);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
