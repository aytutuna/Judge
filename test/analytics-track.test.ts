import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-track-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { analyticsDb } = await import("../lib/analytics/db");
const { track } = await import("../lib/analytics/track");
const { getDb } = await import("../lib/db");
// The real table comes from Better Auth, which this test does not load.
await (await getDb()).execute('CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, age_confirmed_at TEXT, age_blocked_at TEXT, age_block_final TEXT, age_block_final_at TEXT, age_dob TEXT, age_dob_at TEXT, age_signal TEXT, age_signal_at TEXT, age_country TEXT, age_quebec TEXT, age_region_lifted_at TEXT, age_parent TEXT)');

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function query(sql: string, args: (string | number)[] = []) {
  return (await (await analyticsDb()).execute({ sql, args })).rows;
}

describe("track", () => {
  it("stores a server event", async () => {
    await track("case_created", { userId: "user-t", props: { mode: "two_sided" } });
    const [row] = await query("SELECT * FROM events WHERE user_id = 'user-t'");
    expect(row).toMatchObject({ name: "case_created", platform: "server", anon_id: null, props: '{"mode":"two_sided"}' });
  });

  it("refuses forbidden props without throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await track("case_created", { userId: "user-u", props: { email: "a@b.co" } });
    expect(await query("SELECT * FROM events WHERE user_id = 'user-u'")).toHaveLength(0);
    expect(error).toHaveBeenCalledOnce();
  });

  it("stores nothing with ANALYTICS_ENABLED=0", async () => {
    vi.stubEnv("ANALYTICS_ENABLED", "0");
    await track("case_created", { userId: "user-v" });
    expect(await query("SELECT * FROM events WHERE user_id = 'user-v'")).toHaveLength(0);
  });
});
