import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-events-cap-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { analyticsDb, DAILY_EVENT_CAP } = await import("../lib/analytics/db");
const { track } = await import("../lib/analytics/track");
const { POST } = await import("../app/api/v1/events/route");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const count = async () => Number((await (await analyticsDb()).execute("SELECT COUNT(*) AS n FROM events")).rows[0].n);

describe("the daily event cap", () => {
  it("refuses events past 200,000 in 24 hours with 503 and one signal line", async () => {
    const db = await analyticsDb();
    await db.execute({
      sql: `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ?)
            INSERT INTO events (at, platform, name) SELECT ?, 'ios', 'app_open' FROM c`,
      args: [DAILY_EVENT_CAP - 1, Date.now() - 60_000],
    });
    await track("case_claimed", { userId: "u1" });
    expect(await count()).toBe(DAILY_EVENT_CAP);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(
      new Request("http://localhost:3600/api/v1/events", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.50" },
        body: JSON.stringify({
          context: { platform: "ios", app_version: "1", anon_id: "4a7fbd85-88ec-4f8a-8c6a-5eb14f3d0a44" },
          events: [{ name: "app_open" }],
        }),
      }),
    );
    expect(res.status).toBe(503);
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[signal:"))).toEqual(["[signal:events_cap]"]);
    expect(error).not.toHaveBeenCalled();
    expect(await count()).toBe(DAILY_EVENT_CAP);

    // Events older than a day no longer count.
    await db.execute({ sql: "UPDATE events SET at = ? WHERE id <= 10", args: [Date.now() - 25 * 60 * 60_000] });
    await track("case_claimed", { userId: "u2" });
    expect(await count()).toBe(DAILY_EVENT_CAP + 1);
    vi.restoreAllMocks();
  });
});
