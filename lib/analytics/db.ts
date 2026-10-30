/**
 * Product analytics: usage events from the apps, the website and the server.
 * Server only.
 *
 * Events never hold user text, names, emails, IP addresses or user agents:
 * names and props are checked in ./validate before anything is written, and
 * the country is the two-letter code Cloudflare derives, nothing finer.
 * Events older than RETENTION_MS are deleted (pruneEvents, daily).
 *
 * Times are Unix milliseconds.
 */

import type { Client } from "@libsql/client";
import { getDb } from "@/lib/db";

export const RETENTION_MS = 90 * 24 * 60 * 60_000;
const PRUNE_INTERVAL_MS = 24 * 60 * 60_000;

export type Platform = "ios" | "android" | "web" | "server";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY,
    at            INTEGER NOT NULL,
    user_id       TEXT,
    anon_id       TEXT,
    device_id     TEXT,
    platform      TEXT NOT NULL CHECK (platform IN ('ios','android','web','server')),
    app_version   TEXT,
    os_version    TEXT,
    device_model  TEXT,
    country       TEXT CHECK (country IS NULL OR length(country) = 2),
    locale        TEXT,
    name          TEXT NOT NULL CHECK (length(name) <= 64),
    props         TEXT CHECK (props IS NULL OR length(props) <= 2048)
  )`,
  "CREATE INDEX IF NOT EXISTS events_at ON events (at)",
  "CREATE INDEX IF NOT EXISTS events_user ON events (user_id, at) WHERE user_id IS NOT NULL",
];

const globalForAnalytics = globalThis as unknown as {
  __verdictAnalyticsReady?: { client: Client; ready: Promise<void> };
  __verdictEventsPruner?: boolean;
};

export async function ensureAnalyticsTables(): Promise<void> {
  const client = await getDb();
  const cached = globalForAnalytics.__verdictAnalyticsReady;
  if (cached?.client === client) return cached.ready;
  const ready = client.batch(SCHEMA, "write").then(
    () => undefined,
    (e: unknown) => {
      globalForAnalytics.__verdictAnalyticsReady = undefined;
      throw e;
    },
  );
  globalForAnalytics.__verdictAnalyticsReady = { client, ready };
  return ready;
}

export async function analyticsDb(): Promise<Client> {
  await ensureAnalyticsTables();
  return getDb();
}

export type EventRow = {
  at: number;
  userId: string | null;
  anonId: string | null;
  deviceId: string | null;
  platform: Platform;
  appVersion: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  country: string | null;
  locale: string | null;
  name: string;
  props: string | null;
};

export async function insertEvents(rows: EventRow[]): Promise<void> {
  if (!rows.length) return;
  const db = await analyticsDb();
  await db.batch(
    rows.map((r) => ({
      sql: `INSERT INTO events (at, user_id, anon_id, device_id, platform, app_version, os_version,
              device_model, country, locale, name, props)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        r.at,
        r.userId,
        r.anonId,
        r.deviceId,
        r.platform,
        r.appVersion,
        r.osVersion,
        r.deviceModel,
        r.country,
        r.locale,
        r.name,
        r.props,
      ],
    })),
    "write",
  );
}

/** Deletes events older than RETENTION_MS; returns how many. */
export async function pruneEvents(now: number = Date.now()): Promise<number> {
  const db = await analyticsDb();
  const rs = await db.execute({ sql: "DELETE FROM events WHERE at < ?", args: [now - RETENTION_MS] });
  return rs.rowsAffected;
}

async function pruneQuietly(): Promise<void> {
  try {
    const n = await pruneEvents();
    if (n) console.info(`[analytics] deleted ${n} events past retention`);
  } catch (e) {
    console.error("[analytics] pruning events failed:", e instanceof Error ? e.message : String(e));
  }
}

/** Server startup: prune now, then once a day. Once per process. */
export function startEventPruner(): void {
  if (globalForAnalytics.__verdictEventsPruner) return;
  globalForAnalytics.__verdictEventsPruner = true;
  void pruneQuietly();
  const timer = setInterval(() => void pruneQuietly(), PRUNE_INTERVAL_MS);
  timer.unref?.();
}
