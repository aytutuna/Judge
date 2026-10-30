import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-retention-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { analyticsDb, DEVICE_RETENTION_MS, insertEvents, pruneEvents, RETENTION_MS } = await import("../lib/analytics/db");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

async function query(sql: string, args: (string | number)[] = []) {
  return (await (await analyticsDb()).execute({ sql, args })).rows;
}

describe("retention", () => {
  it("deletes events older than 90 days and keeps the rest", async () => {
    const now = Date.now();
    const row = (at: number, name: string) => ({
      at,
      userId: "user-r",
      anonId: null,
      deviceId: null,
      platform: "ios" as const,
      appVersion: "1",
      osVersion: null,
      deviceModel: null,
      country: null,
      locale: null,
      name,
      props: null,
    });
    await insertEvents([
      row(now - RETENTION_MS - 60_000, "old"),
      row(now - RETENTION_MS + 60_000, "almost_old"),
      row(now, "new"),
    ]);
    expect(await pruneEvents(now)).toEqual({ events: 1, devices: 0 });
    const left = await query("SELECT name FROM events WHERE user_id = 'user-r' ORDER BY at");
    expect(left.map((r) => r.name)).toEqual(["almost_old", "new"]);
  });

  it("deletes device links unused for 180 days", async () => {
    const now = Date.now();
    const link = (user: string, lastSeen: number) =>
      query(
        `INSERT INTO account_devices (user_id, device_id, platform, country, first_seen, last_seen)
         VALUES (?, 'device-r-0001', 'ios', NULL, ?, ?)`,
        [user, lastSeen - 1000, lastSeen],
      );
    await link("user-old", now - DEVICE_RETENTION_MS - 60_000);
    await link("user-recent", now - DEVICE_RETENTION_MS + 60_000);
    expect(await pruneEvents(now)).toEqual({ events: 0, devices: 1 });
    const left = await query("SELECT user_id FROM account_devices WHERE device_id = 'device-r-0001'");
    expect(left.map((r) => r.user_id)).toEqual(["user-recent"]);
  });
});
