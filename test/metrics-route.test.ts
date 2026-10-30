import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-metrics-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { insertEvents } = await import("../lib/analytics/db");
const { cachedMetricsText, isLocalRequest, metricsText } = await import("../lib/analytics/metrics");
const { GET } = await import("../app/api/internal/metrics/route");

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
const NOW = Date.now();

type Seed = { at?: number; user?: string; anon?: string; platform?: "ios" | "android" | "web" | "server"; name: string };
const seed = (events: Seed[]) =>
  insertEvents(
    events.map((e) => ({
      at: e.at ?? NOW - 60_000,
      userId: e.user ?? null,
      anonId: e.anon ?? null,
      deviceId: null,
      platform: e.platform ?? "ios",
      appVersion: e.platform === "server" ? null : "1",
      osVersion: null,
      deviceModel: null,
      country: null,
      locale: null,
      name: e.name,
      props: null,
    })),
  );

const local = (extra: Record<string, string> = {}) =>
  new Request("http://127.0.0.1:3000/api/internal/metrics", {
    headers: { host: "127.0.0.1:3000", "x-forwarded-for": "127.0.0.1", ...extra },
  });

describe("isLocalRequest", () => {
  it("only a direct request on the machine itself", () => {
    expect(isLocalRequest(local().headers)).toBe(true);
    expect(isLocalRequest(local({ "x-forwarded-for": "::1" }).headers)).toBe(true);
    expect(isLocalRequest(local({ host: "localhost:3000", "x-forwarded-for": "::ffff:127.0.0.1" }).headers)).toBe(true);
    // Through Caddy: the visitor's address and the site's host.
    expect(isLocalRequest(local({ "x-forwarded-for": "203.0.113.4" }).headers)).toBe(false);
    expect(isLocalRequest(local({ host: "okjudge.com" }).headers)).toBe(false);
    expect(isLocalRequest(local({ "x-forwarded-for": "127.0.0.1, 203.0.113.4" }).headers)).toBe(false);
    expect(isLocalRequest(new Headers({ host: "127.0.0.1:3000" }))).toBe(false);
  });
});

describe("GET /api/internal/metrics", () => {
  it("404 for anything but a local request", async () => {
    const res = await GET(local({ "x-forwarded-for": "198.51.100.2", host: "okjudge.com" }));
    expect(res.status).toBe(404);
  });

  it("counts events, active people and the funnel in the Prometheus text format", async () => {
    await seed([
      { user: "u1", name: "app_open" },
      { user: "u1", name: "app_open" },
      { anon: "a1", name: "app_open", platform: "android" },
      { anon: "a2", name: "app_open", platform: "web", at: NOW - 3 * DAY },
      { user: "u1", name: "case_started" },
      { user: "u1", name: "case_submitted" },
      { user: "u1", name: "verdict_ready", platform: "server" },
      { user: "u2", name: "purchase_granted", platform: "server" },
      // Outside every window.
      { user: "u9", name: "app_open", at: NOW - 8 * DAY },
    ]);
    const res = await GET(local());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain; version=0.0.4");
    const text = await res.text();
    expect(text).toBe(await metricsText());
    expect(text.split("\n")).toEqual([
      "# HELP judge_events_total Usage events in the last 24 hours.",
      "# TYPE judge_events_total gauge",
      'judge_events_total{name="app_open",platform="android"} 1',
      'judge_events_total{name="app_open",platform="ios"} 2',
      'judge_events_total{name="case_started",platform="ios"} 1',
      'judge_events_total{name="case_submitted",platform="ios"} 1',
      'judge_events_total{name="purchase_granted",platform="server"} 1',
      'judge_events_total{name="verdict_ready",platform="server"} 1',
      "# HELP judge_active_users_24h People (accounts or signed-out installs) who sent events in the last 24 hours.",
      "# TYPE judge_active_users_24h gauge",
      "judge_active_users_24h 2",
      "# HELP judge_active_users_7d People who sent events in the last 7 days.",
      "# TYPE judge_active_users_7d gauge",
      "judge_active_users_7d 3",
      "# HELP judge_funnel People who reached each step in the last 7 days.",
      "# TYPE judge_funnel gauge",
      'judge_funnel{step="app_open"} 3',
      'judge_funnel{step="case_started"} 1',
      'judge_funnel{step="case_submitted"} 1',
      'judge_funnel{step="verdict_ready"} 1',
      'judge_funnel{step="purchase_granted"} 1',
      "",
    ]);
  });

  it("serves the same text for a minute", async () => {
    const first = await cachedMetricsText(NOW);
    await seed([{ user: "u3", name: "share_tapped" }]);
    expect(await cachedMetricsText(NOW + 30_000)).toBe(first);
    expect(await cachedMetricsText(NOW + 61_000)).toContain('judge_events_total{name="share_tapped",platform="ios"} 1');
  });
});
