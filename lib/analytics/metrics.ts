/**
 * Usage aggregates in the Prometheus text format, for Alloy to scrape from
 * the server itself (GET /api/internal/metrics). Server only.
 */

import { analyticsDb } from "./db";
import { CLIENT_EVENTS, SERVER_EVENTS } from "./validate";

const DAY_MS = 24 * 60 * 60_000;
const CACHE_MS = 60_000;

/** One client step to count everyone who opens the app, website included,
 * then server steps only, which no client can skip or fake. */
export const FUNNEL = ["app_open", "case_created", "verdict_ready", "purchase_granted"] as const;
const KNOWN = [...CLIENT_EVENTS, ...SERVER_EVENTS];

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i;

/**
 * True only for a request made on this machine straight to the app. Next
 * fills X-Forwarded-For with the socket's address when the request has none,
 * and Caddy always sets it to the visitor's address and passes the site's
 * Host on, so a request through Caddy never passes both checks.
 */
export function isLocalRequest(headers: Headers): boolean {
  const forwarded = headers.get("x-forwarded-for")?.trim() ?? "";
  const host = headers.get("host")?.trim() ?? "";
  return LOOPBACK.has(forwarded) && LOOPBACK_HOST.test(host);
}

// Signed-in and signed-out people counted apart, so ids cannot collide.
const ACTOR = "COALESCE('u:' || user_id, 'a:' || anon_id)";

export async function metricsText(now: number = Date.now()): Promise<string> {
  const db = await analyticsDb();
  const day = now - DAY_MS;
  const week = now - 7 * DAY_MS;
  const [counts, active, funnel] = await Promise.all([
    db.execute({
      sql: `SELECT name, platform, COUNT(*) AS n FROM events
            WHERE at >= ? AND name IN (${KNOWN.map(() => "?").join(", ")})
            GROUP BY name, platform ORDER BY name, platform`,
      args: [day, ...KNOWN],
    }),
    // The server's own events (a renewal, a sign-in elsewhere) do not make anyone active.
    db.execute({
      sql: `SELECT COUNT(DISTINCT CASE WHEN at >= ? THEN ${ACTOR} END) AS day,
                   COUNT(DISTINCT ${ACTOR}) AS week
            FROM events WHERE at >= ? AND platform <> 'server'`,
      args: [day, week],
    }),
    db.execute({
      sql: `SELECT name, COUNT(DISTINCT ${ACTOR}) AS n FROM events
            WHERE at >= ? AND name IN (${FUNNEL.map(() => "?").join(", ")}) GROUP BY name`,
      args: [week, ...FUNNEL],
    }),
  ]);
  const steps = new Map(funnel.rows.map((r) => [String(r.name), Number(r.n)]));
  return [
    "# HELP judge_events_24h Usage events in the last 24 hours.",
    "# TYPE judge_events_24h gauge",
    ...counts.rows.map((r) => `judge_events_24h{name="${r.name}",platform="${r.platform}"} ${Number(r.n)}`),
    "# HELP judge_active_users_24h People (accounts or signed-out installs) who sent events in the last 24 hours.",
    "# TYPE judge_active_users_24h gauge",
    `judge_active_users_24h ${Number(active.rows[0]?.day ?? 0)}`,
    "# HELP judge_active_users_7d People who sent events in the last 7 days.",
    "# TYPE judge_active_users_7d gauge",
    `judge_active_users_7d ${Number(active.rows[0]?.week ?? 0)}`,
    "# HELP judge_funnel People who reached each step in the last 7 days.",
    "# TYPE judge_funnel gauge",
    ...FUNNEL.map((step) => `judge_funnel{step="${step}"} ${steps.get(step) ?? 0}`),
    "",
  ].join("\n");
}

const globalForMetrics = globalThis as unknown as { __judgeMetrics?: { at: number; text: string } };

/** metricsText, computed at most once a minute. */
export async function cachedMetricsText(now: number = Date.now()): Promise<string> {
  const cached = globalForMetrics.__judgeMetrics;
  if (cached && now - cached.at < CACHE_MS) return cached.text;
  const text = await metricsText(now);
  globalForMetrics.__judgeMetrics = { at: now, text };
  return text;
}
