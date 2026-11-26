/**
 * The age check. Judge is for 13 and up. An account is confirmed once it has
 * a date of birth of 13 or more, an app-store age signal that allows it, or
 * (old app builds only) the "I'm 18 or older" tick. It is blocked when the
 * date says under 13, or the store says so outright (under13: true). Such a
 * block is final: only the owner can clear it, by hand. Nothing is deleted
 * on a block.
 *
 * Blocks made before the 13+ rule (age_blocked_at without age_block_final)
 * were made by the old under-18 rule, so the person may give a date once:
 * 13 and over lifts the block, under 13 makes it final.
 *
 * The date of birth is kept (age_dob) only while the person is under 18,
 * since it is what tells us the day they turn 18; the daily cleanup clears
 * it after that. Whoever gave a date keeps only age_dob_at, and the younger
 * answer wins between the date and the store's signal (age_signal): teen
 * means under 18 by the date, or a store signal of "minor" whatever the date
 * says, until the store says adult. A store signal of under 13 blocks even
 * with a date of 13 or more on file. An under-13 date is not kept at all,
 * just the block.
 *
 * resolveViewer (lib/auth.ts) applies the rules below to every request it
 * looks up; routes answer with ageGateResponse before doing anything else.
 */

import type { InStatement, InValue } from "@libsql/client";
import { NextResponse } from "next/server";
import type { AgeState } from "./account-types";
import { apiErrorBody } from "./api-errors";
import { underEighteen, underThirteen } from "./age-date";
import { getDb } from "./db";
import { ensureEntitlementTables, entitlementWriteBatch } from "./entitlements";
import { POLICY_VERSION } from "./policy";
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
 * One blocked under the old rule (needsDob) may also give its date of birth.
 * Sign-out is under /api/auth, which never asks for this. */
function openWhenBlocked(method: string, path: string, age: AgeState): boolean {
  return (
    (path === "/api/v1/me" && (method === "GET" || method === "DELETE")) ||
    (path === "/api/v1/me/export" && method === "GET") ||
    (path === "/api/v1/me/age" && method === "POST" && age.needsDob) ||
    path.startsWith("/api/v1/auth/")
  );
}

/** Why a signed-in request must be refused, or null. */
export function ageRefusal(method: string, path: string, age: AgeState): AgeRefusal | null {
  if (age.blocked) return openWhenBlocked(method, path, age) ? null : "age_blocked";
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
  blockFinal?: unknown;
  dob?: unknown;
  dobAt?: unknown;
  signal?: unknown;
};

/** The 18th-birthday cut-off in SQL: dates after it are under 18. On 29
 * February it is the 28th, as in yearsBefore (lib/age-date.ts). */
export const ADULT_CUTOFF_SQL = `CASE WHEN strftime('%m-%d', 'now') = '02-29'
  THEN date('now', '-18 years', '-1 day') ELSE date('now', '-18 years') END`;

/** SQL for "this user row is a teen", for an alias of the user table. Same
 * rule as ageStateOf, in UTC. */
export function teenSql(alias: string): string {
  return `((${alias}.age_dob IS NOT NULL AND ${alias}.age_dob > (${ADULT_CUTOFF_SQL}))
    OR ${alias}.age_signal = 'minor')`;
}

/** SQL: some account on the case (owner, respondent, a seat or an invite)
 * is under 18. `id` is the SQL for the case id and appears four times. */
export const caseTeenExists = (id: string) => `EXISTS (SELECT 1 FROM "user" tu WHERE ${teenSql("tu")} AND tu.id IN (
    SELECT owner_id FROM cases WHERE id = ${id} UNION SELECT respondent_user_id FROM cases WHERE id = ${id}
    UNION SELECT user_id FROM case_seats WHERE case_id = ${id} UNION SELECT user_id FROM case_invites WHERE case_id = ${id}))`;

export async function caseHasTeen(caseId: string): Promise<boolean> {
  const db = await getDb();
  const rs = await db.execute({ sql: `SELECT ${caseTeenExists("?")} AS teen`, args: [caseId, caseId, caseId, caseId] });
  return Number(rs.rows[0]?.teen) === 1;
}

/** A verdict its writer, or someone on its case, is a teen for. */
export async function verdictHasTeen(verdictId: string): Promise<boolean> {
  const { ensureOriginalsTables } = await import("./originals/db");
  await ensureOriginalsTables();
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT EXISTS (SELECT 1 FROM verdict_meta m JOIN "user" u ON u.id = m.owner_user_id
                         WHERE m.verdict_id = ? AND ${teenSql("u")})
               OR EXISTS (SELECT 1 FROM verdict_meta m WHERE m.verdict_id = ? AND m.case_id IS NOT NULL
                          AND ${caseTeenExists("m.case_id")}) AS teen`,
    args: [verdictId, verdictId],
  });
  return Number(rs.rows[0]?.teen) === 1;
}

/** The account's state from its stored fields, as of `now`. */
export function ageStateOf(f: AgeFields, now = new Date()): AgeState {
  const blocked = f.blockedAt != null;
  const dob = typeof f.dob === "string" ? f.dob : null;
  const dated = f.dobAt != null || dob !== null;
  const teen = !blocked && (f.signal === "minor" || (dob !== null && underEighteen(dob, now)));
  return { confirmed: f.confirmedAt != null, blocked, teen, needsDob: !dated && (!blocked || f.blockFinal == null) };
}

async function readAge(userId: string, now = new Date()): Promise<AgeState> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT age_confirmed_at, age_blocked_at, age_block_final, age_dob, age_dob_at, age_signal
          FROM "user" WHERE id = ?`,
    args: [userId],
  });
  const row = rs.rows[0];
  return ageStateOf(
    {
      confirmedAt: row?.age_confirmed_at,
      blockedAt: row?.age_blocked_at,
      blockFinal: row?.age_block_final,
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
 * never changes a teen, and a store signal of adult never overrides a teen date.
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

/** Blocks the account for good, which also makes an old block final.
 * Signals only the first time. Null when a date landed first and nothing
 * changed, unless `overDate`: the store's under-13 signal blocks whatever
 * date is on file. */
export async function blockMinor(userId: string, now = new Date(), overDate = false): Promise<AgeState | null> {
  const before = await readAge(userId, now);
  const { ensureAnalyticsTables } = await import("./analytics/db");
  await ensureAnalyticsTables();
  // Callers have seen needsDob, so a date that landed in between wins.
  const [done] = await entitlementWriteBatch([
    {
      sql: `UPDATE "user" SET age_blocked_at = COALESCE(age_blocked_at, ?), age_block_final = '1'
            WHERE id = ?${overDate ? "" : " AND age_dob_at IS NULL"}`,
      args: [now.toISOString(), userId],
    },
    ...withGuard(eventDeletes(userId), { sql: `EXISTS (SELECT 1 FROM "user" WHERE id = ? AND age_block_final = '1')`, args: [userId] }),
  ]);
  if (done.rowsAffected === 0) return null;
  if (!before.blocked) signal("age_blocked");
  return readAge(userId, now);
}

/** Each statement ANDed with a condition, so it only runs when it holds. */
function withGuard(statements: InStatement[], guard: { sql: string; args: InValue[] }): InStatement[] {
  return statements.map((st) => {
    const { sql, args = [] } = typeof st === "string" ? { sql: st } : st;
    return { sql: `${sql} AND ${guard.sql}`, args: [...(args as InValue[]), ...guard.args] };
  });
}

/** Their stored usage events, and the signed-out ones from devices linked to them. */
function eventDeletes(userId: string): InStatement[] {
  return [
    { sql: "DELETE FROM events WHERE user_id = ?", args: [userId] },
    {
      sql: "DELETE FROM events WHERE user_id IS NULL AND device_id IN (SELECT device_id FROM account_devices WHERE user_id = ?)",
      args: [userId],
    },
  ];
}

/** True when usage events must not be kept for the account: a teen, or blocked. */
export async function eventsOff(userId: string): Promise<boolean> {
  const age = await readAge(userId);
  return age.teen || age.blocked;
}

/** The teen flag as of now, for work that started when it may have been false. */
export async function teenNow(userId: string, wasTeen: boolean): Promise<boolean> {
  return wasTeen || (await isTeen(userId).catch(() => false));
}

/**
 * What recording a teen changes besides the account row, so that it commits
 * in the same batch: a training consent that is on is turned off (with a
 * ledger row saying it was automatic), their earlier verdicts and cases stop
 * showing names, and the usage events already stored for them go.
 */
async function teenStatements(userId: string, nowIso: string, guard: { sql: string; args: InValue[] }): Promise<InStatement[]> {
  const [{ ensureOriginalsTables }, { ensureFeedbackTables, withdrawStatements }, { ensureAnalyticsTables }] = await Promise.all([
    import("./originals/db"),
    import("./feedback/db"),
    import("./analytics/db"),
  ]);
  await ensureOriginalsTables();
  await ensureFeedbackTables();
  await ensureAnalyticsTables();
  const onCase = `SELECT id FROM cases WHERE owner_id = ? OR respondent_user_id = ?
    UNION SELECT case_id FROM case_invites WHERE user_id = ? UNION SELECT case_id FROM case_seats WHERE user_id = ?`;
  const statements: InStatement[] = [
    {
      sql: `INSERT INTO consent_ledger (user_id, choice, source, at, policy_version, wording_key, wording_text, lang, platform)
            SELECT ?, 'off', 'switch', ?, ?, 'age.teenWithdrawn', ?, 'en', 'web'
            WHERE EXISTS (SELECT 1 FROM consent_state WHERE user_id = ? AND choice = 'on')`,
      args: [userId, nowIso, POLICY_VERSION, "Turned off automatically because the account is under 18.", userId],
    },
    {
      sql: "UPDATE consent_state SET choice = 'off', updated_at = ?, policy_version = ? WHERE user_id = ? AND choice = 'on'",
      args: [nowIso, POLICY_VERSION, userId],
    },
    ...withdrawStatements(userId, nowIso),
    {
      sql: "UPDATE verdict_meta SET names_visible = 0, updated_at = ? WHERE owner_user_id = ? AND names_visible = 1",
      args: [nowIso, userId],
    },
    {
      sql: `UPDATE verdict_meta SET names_visible = 0, updated_at = ?
            WHERE kind = 'case' AND names_visible = 1 AND case_id IN (${onCase})`,
      args: [nowIso, userId, userId, userId, userId],
    },
    {
      sql: `UPDATE cases SET names_visible = 0 WHERE names_visible = 1 AND id IN (${onCase})`,
      args: [userId, userId, userId, userId],
    },
    ...eventDeletes(userId),
  ];
  // Only when this request's own write to the account row took effect.
  return withGuard(statements, guard);
}

/**
 * A store signal that says under 18. It makes the account a teen at once,
 * whatever date is on file, and leaves needsDob as it was, so the date still
 * decides for an account without one. Only an explicit `under13: true`
 * blocks, and it does so even over a date of 13 or more.
 */
export async function recordMinorSignal(userId: string, under13: boolean | undefined, now = new Date()): Promise<AgeState> {
  const before = await readAge(userId, now);
  // Explicit, so it also makes an old block final.
  if (under13 === true) return (await blockMinor(userId, now, true)) ?? readAge(userId, now);
  if (before.blocked) return before;
  const nowIso = now.toISOString();
  await entitlementWriteBatch([
    {
      sql: `UPDATE "user" SET age_confirmed_at = COALESCE(age_confirmed_at, ?), age_source = 'platform', age_signal = 'minor'
            WHERE id = ? AND age_blocked_at IS NULL`,
      args: [nowIso, userId],
    },
    ...(await teenStatements(userId, nowIso, {
      sql: `EXISTS (SELECT 1 FROM "user" WHERE id = ? AND age_blocked_at IS NULL)`,
      args: [userId],
    })),
  ]);
  return readAge(userId, now);
}

/**
 * The date of birth, once. Null when one was already given: only the owner
 * changes it, by clearing age_dob and age_dob_at by hand. Under 13 blocks the
 * account for good and keeps no date; 13 to 17 keeps it and writes the teen
 * changes in the same batch; 18 and over keeps only that a date was given. An
 * account blocked under the old rule gets its one date here too: 13 or more
 * lifts the block.
 */
export async function submitDob(userId: string, dob: string, now = new Date(), claims: string[] = []): Promise<AgeState | null> {
  const before = await readAge(userId, now);
  if (before.blocked && !before.needsDob) return before;
  if (!before.needsDob) return null;
  if (underThirteen(dob, now)) return blockMinor(userId, now);
  const nowIso = now.toISOString();
  const teen = underEighteen(dob, now);
  const [done] = await entitlementWriteBatch([
    {
      sql: `UPDATE "user" SET age_dob = ?, age_dob_at = ?, age_confirmed_at = COALESCE(age_confirmed_at, ?), age_source = 'dob',
              age_blocked_at = NULL, age_block_final = NULL
            WHERE id = ? AND age_dob_at IS NULL AND age_block_final IS NULL`,
      args: [teen ? dob : null, nowIso, nowIso, userId],
    },
    // Only after this request's own write took effect.
    ...(await sameWrite(userId, nowIso, dob, teen, claims)),
  ]);
  if (done.rowsAffected === 0) return null;
  return readAge(userId, now);
}

async function sameWrite(userId: string, nowIso: string, dob: string, teen: boolean, claims: string[]): Promise<InStatement[]> {
  const guard = {
    sql: `EXISTS (SELECT 1 FROM "user" WHERE id = ? AND age_dob_at = ? AND age_dob IS ?)`,
    args: [userId, nowIso, teen ? dob : null] as InValue[],
  };
  const lift: InStatement[] = claims.length
    ? [
        {
          sql: `UPDATE welcome_claims SET age_blocked_at = NULL WHERE claim IN (${claims.map(() => "?").join(", ")})
                AND age_block_final IS NULL AND ${guard.sql}`,
          args: [...claims, ...guard.args],
        },
      ]
    : [];
  return [...lift, ...(teen ? await teenStatements(userId, nowIso, guard) : [])];
}

/** Clears the date of birth of everyone who has turned 18. The teen flag does
 * not depend on it: age_dob_at stays and says a date was given. */
export async function clearAdultDobs(): Promise<number> {
  const db = await getDb();
  try {
    const rs = await db.execute(`UPDATE "user" SET age_dob = NULL WHERE age_dob IS NOT NULL AND age_dob <= (${ADULT_CUTOFF_SQL})`);
    return rs.rowsAffected;
  } catch (e) {
    // Startup cleanup can run before the sign-in migration added the column.
    if (/no such (column|table)/i.test(e instanceof Error ? e.message : String(e))) return 0;
    throw e;
  }
}

/** A blocked account deleting itself: the block stays with the scrambled
 * email kept for the welcome credit (lib/auth.ts welcomeClaim), so a new
 * account with that email starts blocked. A block made under the old rule
 * (`final` false) stays one that a date of birth can lift. */
export async function keepBlock(claim: string, final: boolean, now = new Date()): Promise<void> {
  await ensureEntitlementTables();
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO welcome_claims (claim, created_at, age_blocked_at, age_block_final) VALUES (?, ?, ?, ?)
          ON CONFLICT (claim) DO UPDATE SET age_blocked_at = COALESCE(age_blocked_at, excluded.age_blocked_at),
            age_block_final = COALESCE(excluded.age_block_final, age_block_final)`,
    args: [claim, now.toISOString(), now.toISOString(), final ? "1" : null],
  });
}

/** When that email's earlier account was blocked, and whether the block is
 * final, else null. `legacy` is the claim stored before aliases were folded
 * together. */
export async function keptBlock(claim: string, legacy?: string | null): Promise<{ at: string; final: boolean } | null> {
  await ensureEntitlementTables();
  const db = await getDb();
  const rs = await db.execute({
    sql: "SELECT min(age_blocked_at) AS at, max(age_block_final) AS final FROM welcome_claims WHERE claim IN (?, ?)",
    args: [claim, legacy ?? claim],
  });
  const at = rs.rows[0]?.at;
  return at == null ? null : { at: String(at), final: rs.rows[0].final != null };
}
