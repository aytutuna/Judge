/**
 * The age check. Judge is for 13 and up. An account is confirmed once it has
 * a date of birth of 13 or more, an app-store age signal that allows it, or
 * (old app builds only) the "I'm 18 or older" tick. It is blocked when the
 * date or the store's signal says under 13. A block is never lifted here:
 * only the owner can clear it, by hand. Nothing is deleted on a block.
 *
 * The date of birth is kept (age_dob) only for someone under 18 when they
 * give it, since it is what tells us the day they turn 18. For an adult only
 * the fact that a date was given is kept (age_dob_at); an under-13 date is
 * not kept at all, just the block. The teen flag is worked out from the date
 * on every read, so it ends on the 18th birthday. Without a date it follows
 * the store's last signal (age_signal).
 *
 * resolveViewer (lib/auth.ts) applies the rules below to every request it
 * looks up; routes answer with ageGateResponse before doing anything else.
 */

import { NextResponse } from "next/server";
import type { AgeState } from "./account-types";
import { apiErrorBody } from "./api-errors";
import { getDb } from "./db";
import { ensureEntitlementTables } from "./entitlements";
import { signal } from "./signals";

export type AgeSource = "checkbox" | "platform" | "dob";

export type AgeRefusal = "age_blocked" | "age_unconfirmed";

/** Starting AI work or spending a credit: POST only. */
const NEEDS_CONFIRMED = [
  /^\/api\/(v1\/)?verdict$/,
  /^\/api\/v1\/clarify$/,
  /^\/api\/v1\/evidence$/,
  /^\/api\/v1\/cases$/,
  /^\/api\/v1\/cases\/[^/]+\/(judge|appeals)$/,
  /^\/api\/v1\/verdicts\/[^/]+\/appeals$/,
  /^\/api\/v1\/respond\/[^/]+(\/(appeals|evidence))?$/,
];

/** The path as the router matched it: /api/v1/%76erdict is /api/v1/verdict. */
export function requestPath(req: Request): string {
  const path = new URL(req.url).pathname;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function needsConfirmed(method: string, path: string): boolean {
  return method === "POST" && NEEDS_CONFIRMED.some((re) => re.test(path));
}

/** What a blocked account may still do: see its state, download its data, delete itself, and
 * finish a sign-in (the Apple code is kept so deletion can revoke it).
 * Sign-out is under /api/auth, which never asks for this. */
function openWhenBlocked(method: string, path: string): boolean {
  return (
    (path === "/api/v1/me" && (method === "GET" || method === "DELETE")) ||
    (path === "/api/v1/me/export" && method === "GET") ||
    path.startsWith("/api/v1/auth/")
  );
}

/** Why a signed-in request must be refused, or null. */
export function ageRefusal(method: string, path: string, age: AgeState): AgeRefusal | null {
  if (age.blocked) return openWhenBlocked(method, path) ? null : "age_blocked";
  if (!age.confirmed && needsConfirmed(method, path)) return "age_unconfirmed";
  return null;
}

/** The answer for a request the age check stops, else null. "unavailable":
 * the session lookup failed on a route that needs a confirmed age. */
export function ageGateResponse(lookup: { gate?: AgeRefusal | "unavailable" }): NextResponse | null {
  const headers = { "Cache-Control": "no-store" };
  if (!lookup.gate) return null;
  if (lookup.gate === "unavailable") {
    return NextResponse.json(apiErrorBody("unavailable", "Your account is unavailable right now."), {
      status: 503,
      headers,
    });
  }
  // `error` carries the code too: the apps match on it.
  return NextResponse.json({ error: lookup.gate, code: lookup.gate }, { status: 403, headers });
}

export type AgeFields = {
  confirmedAt?: unknown;
  blockedAt?: unknown;
  dob?: unknown;
  dobAt?: unknown;
  signal?: unknown;
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The calendar date `years` before `now` (UTC), as YYYY-MM-DD. A 29 February
 * lands on 1 March, as SQLite's date() does. */
function yearsBefore(now: Date, years: number): string {
  return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
}

/** A real calendar date as YYYY-MM-DD, not in the future, not before 1900. */
export function validDob(value: unknown, now = new Date()): value is string {
  const m = typeof value === "string" ? DAY.exec(value) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value && value >= "1900-01-01" && value <= now.toISOString().slice(0, 10);
}

export function underThirteen(dob: string, now = new Date()): boolean {
  return dob > yearsBefore(now, 13);
}

export function underEighteen(dob: string, now = new Date()): boolean {
  return dob > yearsBefore(now, 18);
}

/** SQL for "this user row is a teen", for an alias of the user table. Same
 * rule as ageStateOf, in UTC. */
export function teenSql(alias: string): string {
  return `((${alias}.age_dob IS NOT NULL AND ${alias}.age_dob > date('now', '-18 years'))
    OR (${alias}.age_dob IS NULL AND ${alias}.age_signal = 'minor'))`;
}

/** The account's state from its stored fields, as of `now`. */
export function ageStateOf(f: AgeFields, now = new Date()): AgeState {
  const blocked = f.blockedAt != null;
  const dob = typeof f.dob === "string" ? f.dob : null;
  const teen = !blocked && (dob !== null ? underEighteen(dob, now) : f.signal === "minor");
  return { confirmed: f.confirmedAt != null, blocked, teen, needsDob: !blocked && f.dobAt == null };
}

async function readAge(userId: string, now = new Date()): Promise<AgeState> {
  const db = await getDb();
  const rs = await db.execute({
    sql: 'SELECT age_confirmed_at, age_blocked_at, age_dob, age_dob_at, age_signal FROM "user" WHERE id = ?',
    args: [userId],
  });
  const row = rs.rows[0];
  return ageStateOf(
    {
      confirmedAt: row?.age_confirmed_at,
      blockedAt: row?.age_blocked_at,
      dob: row?.age_dob,
      dobAt: row?.age_dob_at,
      signal: row?.age_signal,
    },
    now,
  );
}

/** True when the account is a teen right now (false for an unknown id). */
export async function isTeen(userId: string, now = new Date()): Promise<boolean> {
  return (await readAge(userId, now)).teen;
}

/**
 * An adult confirmation: the old builds' tick, or a store signal saying 18+.
 * Keeps the first confirmation time; the source is the latest one. A tick
 * never changes a teen (a date or a store signal under 18 wins over it); a
 * store signal also replaces an earlier "minor" one.
 */
export async function confirmAdult(userId: string, source: "checkbox" | "platform", now = new Date()): Promise<AgeState> {
  const before = await readAge(userId, now);
  if (before.blocked || (source === "checkbox" && before.teen)) return before;
  const db = await getDb();
  await db.execute({
    sql: `UPDATE "user" SET age_confirmed_at = COALESCE(age_confirmed_at, ?), age_source = ?,
            age_signal = CASE WHEN ? = 'platform' THEN 'adult' ELSE age_signal END WHERE id = ?`,
    args: [now.toISOString(), source, source, userId],
  });
  return readAge(userId, now);
}

/** Blocks the account for good. Signals only the first time. */
export async function blockMinor(userId: string, now = new Date()): Promise<AgeState> {
  const db = await getDb();
  const rs = await db.execute({
    sql: 'UPDATE "user" SET age_blocked_at = ? WHERE id = ? AND age_blocked_at IS NULL',
    args: [now.toISOString(), userId],
  });
  if (rs.rowsAffected > 0) signal("age_blocked");
  return readAge(userId, now);
}

/** A store signal that says under 18. Under 13 (or no bracket sent) blocks;
 * otherwise the account is a teen, and any training consent is withdrawn. */
export async function recordMinorSignal(userId: string, under13: boolean, now = new Date()): Promise<AgeState> {
  if (under13) return blockMinor(userId, now);
  const before = await readAge(userId, now);
  if (before.blocked) return before;
  const db = await getDb();
  await db.execute({
    sql: `UPDATE "user" SET age_confirmed_at = COALESCE(age_confirmed_at, ?), age_source = 'platform', age_signal = 'minor'
          WHERE id = ?`,
    args: [now.toISOString(), userId],
  });
  const after = await readAge(userId, now);
  if (after.teen) await withdrawTeenConsent(userId);
  return after;
}

/**
 * The date of birth, once. Null when one was already given: only the owner
 * changes it, by clearing age_dob and age_dob_at by hand. Under 13 blocks the
 * account and keeps no date; 13 to 17 keeps it; 18 and over keeps only that a
 * date was given.
 */
export async function submitDob(userId: string, dob: string, now = new Date()): Promise<AgeState | null> {
  const before = await readAge(userId, now);
  if (before.blocked) return before;
  if (!before.needsDob) return null;
  if (underThirteen(dob, now)) return blockMinor(userId, now);
  const db = await getDb();
  const rs = await db.execute({
    sql: `UPDATE "user" SET age_dob = ?, age_dob_at = ?, age_confirmed_at = COALESCE(age_confirmed_at, ?), age_source = 'dob'
          WHERE id = ? AND age_dob_at IS NULL`,
    args: [underEighteen(dob, now) ? dob : null, now.toISOString(), now.toISOString(), userId],
  });
  if (rs.rowsAffected === 0) return null;
  const after = await readAge(userId, now);
  if (after.teen) await withdrawTeenConsent(userId);
  return after;
}

async function withdrawTeenConsent(userId: string): Promise<void> {
  const { ensureOriginalsTables } = await import("./originals/db");
  const { getConsent, recordConsent } = await import("./feedback/db");
  await ensureOriginalsTables();
  if ((await getConsent(userId)).state !== "on") return;
  await recordConsent(userId, {
    choice: "off",
    source: "switch",
    wordingKey: "age.teenWithdrawn",
    wordingText: "Withdrawn because the account is under 18.",
    lang: "en",
    platform: "web",
  });
}

/** A blocked account deleting itself: the block stays with the scrambled
 * email kept for the welcome credit (lib/auth.ts welcomeClaim), so a new
 * account with that email starts blocked. */
export async function keepBlock(claim: string, now = new Date()): Promise<void> {
  await ensureEntitlementTables();
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO welcome_claims (claim, created_at, age_blocked_at) VALUES (?, ?, ?)
          ON CONFLICT (claim) DO UPDATE SET age_blocked_at = COALESCE(age_blocked_at, excluded.age_blocked_at)`,
    args: [claim, now.toISOString(), now.toISOString()],
  });
}

/** When that email's earlier account was blocked, else null. `legacy` is the
 * claim stored before aliases were folded together. */
export async function keptBlock(claim: string, legacy?: string | null): Promise<string | null> {
  await ensureEntitlementTables();
  const db = await getDb();
  const rs = await db.execute({
    sql: "SELECT min(age_blocked_at) AS at FROM welcome_claims WHERE claim IN (?, ?)",
    args: [claim, legacy ?? claim],
  });
  const at = rs.rows[0]?.at;
  return at == null ? null : String(at);
}
