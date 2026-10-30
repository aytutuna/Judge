/**
 * The 18+ check. An account is confirmed once the user ticks "I'm 18 or
 * older" (website, apps) or the app store's age signal says so, and blocked
 * when that signal says the user is a minor. A block is never lifted here:
 * only the owner can clear it, by hand. Nothing is deleted on a block.
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

export type AgeSource = "checkbox" | "platform";

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

/** What a blocked account may still do: see its state, delete itself, and
 * finish a sign-in (the Apple code is kept so deletion can revoke it).
 * Sign-out is under /api/auth, which never asks for this. */
function openWhenBlocked(method: string, path: string): boolean {
  return (path === "/api/v1/me" && (method === "GET" || method === "DELETE")) || path.startsWith("/api/v1/auth/");
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

async function readAge(userId: string): Promise<AgeState> {
  const db = await getDb();
  const rs = await db.execute({
    sql: 'SELECT age_confirmed_at, age_blocked_at FROM "user" WHERE id = ?',
    args: [userId],
  });
  const row = rs.rows[0];
  return { confirmed: row?.age_confirmed_at != null, blocked: row?.age_blocked_at != null };
}

/** Keeps the first confirmation time; the source is the latest one. */
export async function confirmAdult(userId: string, source: AgeSource, now = new Date()): Promise<AgeState> {
  const db = await getDb();
  await db.execute({
    sql: 'UPDATE "user" SET age_confirmed_at = COALESCE(age_confirmed_at, ?), age_source = ? WHERE id = ?',
    args: [now.toISOString(), source, userId],
  });
  return readAge(userId);
}

/** Blocks the account for good. Signals only the first time. */
export async function blockMinor(userId: string, now = new Date()): Promise<AgeState> {
  const db = await getDb();
  const rs = await db.execute({
    sql: 'UPDATE "user" SET age_blocked_at = ? WHERE id = ? AND age_blocked_at IS NULL',
    args: [now.toISOString(), userId],
  });
  if (rs.rowsAffected > 0) signal("age_blocked");
  return readAge(userId);
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

/** When that email's earlier account was blocked, else null. */
export async function keptBlock(claim: string): Promise<string | null> {
  await ensureEntitlementTables();
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT age_blocked_at FROM welcome_claims WHERE claim = ?", args: [claim] });
  const at = rs.rows[0]?.age_blocked_at;
  return at == null ? null : String(at);
}
