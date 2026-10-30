import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-events-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3600";

const { createDevSession } = await import("../lib/auth");
const { analyticsDb } = await import("../lib/analytics/db");
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

afterEach(() => {
  vi.unstubAllEnvs();
});

const URL_EVENTS = "http://localhost:3600/api/v1/events";
const ANON = "0b5a3a3e-7c1f-4d47-8f0e-6a3c1d2e9f00";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request(URL_EVENTS, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", "user-agent": "JudgeApp/1.4", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

async function rowsFor(where: string, args: (string | number)[]) {
  const db = await analyticsDb();
  return (await db.execute({ sql: `SELECT * FROM events WHERE ${where} ORDER BY id`, args })).rows;
}

describe("POST /api/v1/events", () => {
  it("signed out with anon_id: 204 and the events stored without an account", async () => {
    const res = await post({
      context: { platform: "android", app_version: "1.0.3", anon_id: ANON, device_model: "Pixel 8", locale: "en-GB" },
      events: [{ name: "app_open" }, { name: "screen_view", props: { screen: "home" } }],
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const rows = await rowsFor("anon_id = ?", [ANON]);
    expect(rows.map((r) => r.name)).toEqual(["app_open", "screen_view"]);
    expect(rows[0]).toMatchObject({
      user_id: null,
      platform: "android",
      app_version: "1.0.3",
      device_model: "Pixel 8",
      locale: "en-GB",
      country: null,
      props: null,
    });
    expect(JSON.parse(String(rows[1].props))).toEqual({ screen: "home" });
    // Nothing about the connection is kept.
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain("203.0.113.9");
    expect(stored).not.toContain("JudgeApp");
  });

  it("signed out without anon_id: 400", async () => {
    const res = await post({ context: { platform: "web", app_version: "web" }, events: [{ name: "app_open" }] });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid");
  });

  it("signed in by bearer: the events belong to the account", async () => {
    const { token, user } = await createDevSession("events1@verdict.local");
    const res = await post(
      { context: { platform: "ios", app_version: "2.0.0", device_id: "DEV-0001-abcd" }, events: [{ name: "case_started" }] },
      { authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(204);
    const rows = await rowsFor("user_id = ? AND name = 'case_started'", [user.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ platform: "ios", device_id: "DEV-0001-abcd", anon_id: null });
  });

  it("a dead bearer token: 401 signin_required", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await post(
      { context: { platform: "ios", app_version: "2.0.0", anon_id: ANON }, events: [{ name: "app_open" }] },
      { authorization: "Bearer nope" },
    );
    expect(res.status).toBe(401);
    vi.restoreAllMocks();
  });

  it("refuses the whole batch on any invalid event", async () => {
    const before = (await rowsFor("anon_id = ?", [ANON])).length;
    const cases = [
      { context: { platform: "ios", app_version: "1", anon_id: ANON }, events: [{ name: "app_open" }, { name: "x", props: { message: "hi" } }] },
      { context: { platform: "ios", app_version: "1", anon_id: ANON }, events: [{ name: "app_open", extra: true }] },
      { context: { platform: "ios", app_version: "1", anon_id: ANON, ip: "1.2.3.4" }, events: [{ name: "app_open" }] },
      { context: { platform: "ios", app_version: "1", anon_id: ANON }, events: [{ name: "sign_in" }] },
      { context: { platform: "ios", app_version: "1", anon_id: ANON }, events: [{ name: "app_open", props: { big: "x".repeat(99), ...Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, "y".repeat(90)])) } }] },
    ];
    for (const body of cases) expect((await post(body)).status).toBe(400);
    expect((await post("{not json")).status).toBe(400);
    expect((await rowsFor("anon_id = ?", [ANON])).length).toBe(before);
  });

  it("413 for a body over 128 KB", async () => {
    const res = await post("x".repeat(129 * 1024));
    expect(res.status).toBe(413);
  });

  it("country from CF-IPCountry only with CLOUDFLARE_PROXY=1", async () => {
    const anon = "1d4c8a52-55b9-4c57-9f37-2b8e1c0a7d11";
    const body = { context: { platform: "web", app_version: "web-1", anon_id: anon }, events: [{ name: "app_open" }] };
    await post(body, { "cf-ipcountry": "TR" });
    vi.stubEnv("CLOUDFLARE_PROXY", "1");
    await post(body, { "cf-ipcountry": "TR" });
    expect((await rowsFor("anon_id = ?", [anon])).map((r) => r.country)).toEqual([null, "TR"]);
  });

  it("keeps a plausible client time, else uses the time received", async () => {
    const anon = "2e5d9b63-66ca-4d68-a048-3c9f2d1b8e22";
    const now = Date.now();
    await post({
      context: { platform: "ios", app_version: "1", anon_id: anon },
      events: [
        { name: "app_open", at: now - 60_000 },
        { name: "app_open", at: now - 30 * 24 * 60 * 60_000 },
        { name: "app_open", at: now + 24 * 60 * 60_000 },
      ],
    });
    const ats = (await rowsFor("anon_id = ?", [anon])).map((r) => Number(r.at));
    expect(ats[0]).toBe(now - 60_000);
    expect(ats[1]).toBeGreaterThanOrEqual(now);
    expect(ats[2]).toBeLessThan(now + 60_000);
  });

  it("ANALYTICS_ENABLED=0: 204 and nothing stored", async () => {
    vi.stubEnv("ANALYTICS_ENABLED", "0");
    const anon = "3f6eac74-77db-4e79-b159-4da03e2c9f33";
    const res = await post({ context: { platform: "ios", app_version: "1", anon_id: anon }, events: [{ name: "app_open" }] });
    expect(res.status).toBe(204);
    expect(await rowsFor("anon_id = ?", [anon])).toHaveLength(0);
  });
});
