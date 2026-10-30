/**
 * Product analytics: usage events from the apps, the website and the server,
 * and which devices each account signs in from. Server only.
 *
 * Events never hold user text, names, emails, IP addresses or user agents:
 * names and props are checked in ./validate before anything is written, and
 * the country is the two-letter code Cloudflare derives, nothing finer.
 * Events older than RETENTION_MS and device links unused for
 * DEVICE_RETENTION_MS are deleted (pruneEvents, daily). At most
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
export const DEVICE_RETENTION_MS = 180 * DAY_MS;
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
  __judgeAnalyticsReady?: { client: Client; ready: Promise<void> };
  __judgeEventsPruner?: boolean;
};

export async function ensureAnalyticsTables(): Promise<void> {
  const client = await getDb();
  const cached = globalForAnalytics.__judgeAnalyticsReady;
  if (cached?.client === client) return cached.ready;
  const ready = client.batch(SCHEMA, "write").then(
    () => undefined,
    (e: unknown) => {
      globalForAnalytics.__judgeAnalyticsReady = undefined;
      throw e;
    },
  );
  globalForAnalytics.__judgeAnalyticsReady = { client, ready };
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

/** Deletes events and device links past their retention; returns how many of each. */
export async function pruneEvents(now: number = Date.now()): Promise<{ events: number; devices: number }> {
  const db = await analyticsDb();
  const [events, devices] = await db.batch(
    [
      { sql: "DELETE FROM events WHERE at < ?", args: [now - RETENTION_MS] },
      { sql: "DELETE FROM account_devices WHERE last_seen < ?", args: [now - DEVICE_RETENTION_MS] },
    ],
    "write",
  );
  return { events: events.rowsAffected, devices: devices.rowsAffected };
}

/**
 * On account deletion: its events go, and its device links lose the account
 * but stay, under a random placeholder per row, so a device still counts the
 * accounts it was used for when someone deletes one and signs up again.
 */
export async function forgetUser(userId: string): Promise<void> {
  const db = await analyticsDb();
  await db.batch(
    [
      { sql: "DELETE FROM events WHERE user_id = ?", args: [userId] },
      {
        sql: "UPDATE account_devices SET user_id = 'deleted:' || lower(hex(randomblob(8))) WHERE user_id = ?",
        args: [userId],
      },
    ],
    "write",
  );
}

async function pruneQuietly(): Promise<void> {
  try {
    const n = await pruneEvents();
    if (n.events || n.devices) {
      console.info(`[analytics] deleted ${n.events} events and ${n.devices} device links past retention`);
    }
  } catch (e) {
    console.error("[analytics] pruning events failed:", e instanceof Error ? e.message : String(e));
  }
}

/** Server startup: prune now, then once a day. Once per process. */
export function startEventPruner(): void {
  if (globalForAnalytics.__judgeEventsPruner) return;
  globalForAnalytics.__judgeEventsPruner = true;
  void pruneQuietly();
  const timer = setInterval(() => void pruneQuietly(), DAY_MS);
  timer.unref?.();
}
