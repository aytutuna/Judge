/**
 * Product analytics: usage events from the apps, the website and the server,
 * and which devices each account signs in from. Server only.
 *
 * Events never hold user text, names, emails, IP addresses or user agents:
 * names and props are checked in ./validate before anything is written, and
 * the country is the two-letter code Cloudflare derives, nothing finer.
 * Events older than RETENTION_MS are deleted (pruneEvents, daily). At most
 * DAILY_EVENT_CAP events are stored per rolling 24 hours, so a flood of fake
 * installs cannot fill the disk.
 *
 * Times are Unix milliseconds.
 */

import type { Client } from "@libsql/client";
import { getDb } from "@/lib/db";
import { signal } from "@/lib/signals";

const DAY_MS = 24 * 60 * 60_000;
export const RETENTION_MS = 90 * DAY_MS;
export const DAILY_EVENT_CAP = 200_000;

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
  `CREATE TABLE IF NOT EXISTS account_devices (
    user_id     TEXT NOT NULL,
    device_id   TEXT NOT NULL,
    platform    TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
    country     TEXT,
    first_seen  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL,
    PRIMARY KEY (user_id, device_id)
  )`,
  "CREATE INDEX IF NOT EXISTS account_devices_device ON account_devices (device_id)",
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

export class EventsCapError extends Error {}

/** Stores the rows, or throws EventsCapError when they would take the last
 * 24 hours past DAILY_EVENT_CAP. */
export async function insertEvents(rows: EventRow[]): Promise<void> {
  if (!rows.length) return;
  const db = await analyticsDb();
  const recent = await db.execute({ sql: "SELECT COUNT(*) AS n FROM events WHERE at >= ?", args: [Date.now() - DAY_MS] });
  if (Number(recent.rows[0].n) + rows.length > DAILY_EVENT_CAP) {
    signal("events_cap");
    throw new EventsCapError("the daily event cap is reached");
  }
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
  const timer = setInterval(() => void pruneQuietly(), DAY_MS);
  timer.unref?.();
}
