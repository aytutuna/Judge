/**
 * Premium entitlements: credit balances, subscriptions, an append-only grant
 * ledger and per-verdict reservations, all in the main database.
 *
 * Write rule: every write is ONE `batch(..., "write")` of conditional
 * statements (atomic in SQLite), run under an in-process mutex and retried on
 * SQLITE_BUSY (another process, e.g. scripts/grant.ts). Interactive
 * transactions are never used: on one shared libSQL client they fail with
 * SQLITE_BUSY under concurrency.
 *
 * Idempotency: each purchase-side event is a grant row keyed by
 * UNIQUE(source, external_id). Statements that apply an event are guarded by
 * `EXISTS (SELECT 1 FROM entitlement_grants WHERE id = <fresh id>)`, so a
 * duplicate event (whose insert is skipped) changes nothing.
 *
 * Timestamps are ISO-8601 UTC strings, so string comparison is time order.
 */

import { nanoid } from "nanoid";
import type { Client, InStatement, InValue, ResultSet } from "@libsql/client";
import type { Entitlement, GrantSource, PremiumBlock, SubscriptionView } from "./account-types";
import { getDb } from "./db";
import { PRICING } from "./pricing";

const STALE_RESERVATION_MS = 10 * 60_000;
const SWEEP_EVERY_MS = 60_000;
const BUSY_RETRIES = 12;

const GRANT_SOURCES: readonly GrantSource[] = ["admin", "app_store", "play_store", "web", "promo"];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS entitlement_accounts (
    user_id     TEXT PRIMARY KEY,
    credits     INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
    updated_at  TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS entitlement_grants (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    source          TEXT NOT NULL,
    external_id     TEXT NOT NULL,
    kind            TEXT NOT NULL,
    product_id      TEXT,
    credits_delta   INTEGER NOT NULL DEFAULT 0,
    subscription_id TEXT,
    ref_external_id TEXT,
    note            TEXT,
    created_at      TEXT NOT NULL,
    UNIQUE (source, external_id)
  )`,
  "CREATE INDEX IF NOT EXISTS entitlement_grants_user ON entitlement_grants (user_id, created_at)",
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id                      TEXT PRIMARY KEY,
    user_id                 TEXT NOT NULL,
    source                  TEXT NOT NULL,
    original_transaction_id TEXT NOT NULL,
    product_id              TEXT NOT NULL,
    status                  TEXT NOT NULL,
    period_start            TEXT NOT NULL,
    period_end              TEXT NOT NULL,
    will_renew              INTEGER NOT NULL DEFAULT 0,
    cap                     INTEGER NOT NULL,
    used_in_period          INTEGER NOT NULL DEFAULT 0,
    updated_at              TEXT NOT NULL,
    UNIQUE (source, original_transaction_id)
  )`,
  "CREATE INDEX IF NOT EXISTS subscriptions_user ON subscriptions (user_id, status, period_end)",
  `CREATE TABLE IF NOT EXISTS premium_usage (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    idempotency_key     TEXT,
    funded_by           TEXT NOT NULL,
    subscription_id     TEXT,
    sub_period_end      TEXT,
    status              TEXT NOT NULL,
    verdict_id          TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS premium_usage_idem ON premium_usage (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL`,
  "CREATE INDEX IF NOT EXISTS premium_usage_user ON premium_usage (user_id, status, created_at)",
  "CREATE INDEX IF NOT EXISTS premium_usage_created ON premium_usage (created_at)",
  // Kept when an account is deleted: one welcome credit per email, ever.
  `CREATE TABLE IF NOT EXISTS welcome_claims (
    claim       TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL
  )`,
];

const globalForEntitlements = globalThis as unknown as {
  __verdictEntitlementsReady?: { client: Client; ready: Promise<void> };
  __verdictEntitlementsChain?: Promise<unknown>;
  __verdictEntitlementsLastSweep?: number;
};

/** Creates the entitlement tables once per process (per database client). */
export async function ensureEntitlementTables(): Promise<void> {
  const client = await getDb();
  const cached = globalForEntitlements.__verdictEntitlementsReady;
  if (cached?.client === client) return cached.ready;
  const ready = withBusyRetry(() => client.batch(SCHEMA, "write")).then(
    () => addHoldColumn(client),
    (e: unknown) => {
      globalForEntitlements.__verdictEntitlementsReady = undefined;
      throw e;
    },
  );
  globalForEntitlements.__verdictEntitlementsReady = { client, ready };
  return ready;
}

/** Adds premium_usage.hold_until (a reservation held past the usual
 * 10-minute crash window, e.g. a two-sided case waiting for its answer).
 * A concurrent process adding it first is fine. */
async function addHoldColumn(db: Client): Promise<void> {
  const info = await db.execute("PRAGMA table_info(premium_usage)");
  if (info.rows.some((r) => String(r.name) === "hold_until")) return;
  try {
    await withBusyRetry(() => db.execute("ALTER TABLE premium_usage ADD COLUMN hold_until TEXT"));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/duplicate column name/i.test(message)) throw e;
  }
}

async function client(): Promise<Client> {
  await ensureEntitlementTables();
  return getDb();
}

function isBusy(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return (
    (typeof code === "string" && code.startsWith("SQLITE_BUSY")) ||
    /SQLITE_BUSY|database is locked/i.test(message)
  );
}

function isUniqueViolation(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /UNIQUE constraint failed/i.test(message);
}

async function withBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isBusy(e) || attempt >= BUSY_RETRIES) throw e;
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 40 * (attempt + 1)));
    }
  }
}

/** Runs one write at a time in this process. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalForEntitlements.__verdictEntitlementsChain ?? Promise.resolve();
  const run = prev.then(fn, fn);
  globalForEntitlements.__verdictEntitlementsChain = run.catch(() => undefined);
  return run;
}

/** One atomic, serialized, busy-retried batch of statements. */
async function writeBatch(stmts: InStatement[]): Promise<ResultSet[]> {
  const db = await client();
  return serialized(() => withBusyRetry(() => db.batch(stmts, "write")));
}

/** The same serialized writer for other modules whose writes must not race
 * credit writes (two-sided cases): one atomic batch of statements. */
export async function entitlementWriteBatch(stmts: InStatement[]): Promise<ResultSet[]> {
  return writeBatch(stmts);
}

/** An extra condition ANDed into a reservation statement, e.g.
 * `EXISTS (SELECT 1 FROM cases WHERE id = ? AND judging_token = ?)`. */
export type StatementGuard = { sql: string; args: InValue[] };

const guardSql = (guard?: StatementGuard) => (guard ? ` AND ${guard.sql}` : "");
const guardArgs = (guard?: StatementGuard) => (guard ? guard.args : []);

/** Keeps a reservation open until `untilIso` (the stale sweep refunds it 10
 * minutes after that). No-op unless still reserved. */
export function holdStatement(reservationId: string, untilIso: string, guard?: StatementGuard): InStatement {
  return {
    sql: `UPDATE premium_usage SET hold_until = ? WHERE id = ? AND status = 'reserved'${guardSql(guard)}`,
    args: [untilIso, reservationId, ...guardArgs(guard)],
  };
}

/** Marks a reservation spent on `verdictId`, for use inside a larger batch. */
export function consumeStatement(
  reservationId: string,
  verdictId: string,
  nowIso: string,
  guard?: StatementGuard,
): InStatement {
  return {
    sql: `UPDATE premium_usage SET status = 'consumed', verdict_id = ?, updated_at = ?
          WHERE id = ? AND status = 'reserved'${guardSql(guard)}`,
    args: [verdictId, nowIso, reservationId, ...guardArgs(guard)],
  };
}

/** The refund of one reservation as statements for a larger batch (the
 * same three statements refundPremiumVerdict runs). No-op unless reserved. */
export function refundStatements(reservationId: string, nowIso: string, guard?: StatementGuard): InStatement[] {
  const g = guardSql(guard);
  const ga = guardArgs(guard);
  return [
    {
      sql: `UPDATE entitlement_accounts SET credits = credits + 1, updated_at = ?
            WHERE user_id = (SELECT user_id FROM premium_usage
                             WHERE id = ? AND status = 'reserved' AND funded_by = 'credits')${g}`,
      args: [nowIso, reservationId, ...ga],
    },
    {
      sql: `UPDATE subscriptions SET used_in_period = MAX(used_in_period - 1, 0), updated_at = ?
            WHERE (id, period_end) = (SELECT subscription_id, sub_period_end FROM premium_usage
                                      WHERE id = ? AND status = 'reserved' AND funded_by = 'subscription')${g}`,
      args: [nowIso, reservationId, ...ga],
    },
    {
      sql: `UPDATE premium_usage SET status = 'refunded', updated_at = ? WHERE id = ? AND status = 'reserved'${g}`,
      args: [nowIso, reservationId, ...ga],
    },
  ];
}

const iso = (d: Date) => d.toISOString();

function normalizeIso(value: string, field: string): string {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) throw new Error(`${field} is not a valid date`);
  return d.toISOString();
}

function assertSource(source: GrantSource): void {
  if (!GRANT_SOURCES.includes(source)) throw new Error(`unknown grant source: ${String(source)}`);
}

function assertId(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new Error(`${field} must be a non-empty string of at most 200 characters`);
  }
}

const grantExists = (id: string) => ({
  sql: "EXISTS (SELECT 1 FROM entitlement_grants WHERE id = ?)",
  args: [id],
});

// --- Reading ------------------------------------------------------------------

type SubRow = {
  id: string;
  source: GrantSource;
  productId: string;
  periodStart: string;
  periodEnd: string;
  willRenew: boolean;
  used: number;
  cap: number;
};

/** Active subscriptions covering `now`, usable ones first, then the latest
 * period end. */
async function activeSubscriptions(db: Client, userId: string, nowIso: string): Promise<SubRow[]> {
  const rs = await db.execute({
    sql: `SELECT id, source, product_id, period_start, period_end, will_renew, used_in_period, cap
          FROM subscriptions
          WHERE user_id = ? AND status = 'active' AND period_start <= ? AND period_end > ?
          ORDER BY (used_in_period < cap) DESC, period_end DESC`,
    args: [userId, nowIso, nowIso],
  });
  return rs.rows.map((r) => ({
    id: String(r.id),
    source: String(r.source) as GrantSource,
    productId: String(r.product_id),
    periodStart: String(r.period_start),
    periodEnd: String(r.period_end),
    willRenew: Number(r.will_renew) === 1,
    used: Number(r.used_in_period),
    cap: Number(r.cap),
  }));
}

function toView(sub: SubRow): SubscriptionView {
  return {
    source: sub.source,
    productId: sub.productId,
    periodStart: sub.periodStart,
    periodEnd: sub.periodEnd,
    willRenew: sub.willRenew,
    used: sub.used,
    cap: sub.cap,
  };
}

/** What the user can do right now. Also refunds stale reservations first
 * (at most once a minute per process). */
export async function getEntitlement(userId: string, now: Date = new Date()): Promise<Entitlement> {
  await maybeSweep(now);
  const db = await client();
  const nowIso = iso(now);
  const [subs, acct] = await Promise.all([
    activeSubscriptions(db, userId, nowIso),
    db.execute({ sql: "SELECT credits FROM entitlement_accounts WHERE user_id = ?", args: [userId] }),
  ]);
  const credits = Number(acct.rows[0]?.credits ?? 0);
  const sub = subs[0] ?? null;
  const subUsable = sub !== null && sub.used < sub.cap;
  const canUsePremium = subUsable || credits > 0;

  // Every verdict is premium, so an account that never bought anything is
  // simply out of credits too.
  const blockedReason: PremiumBlock | null = canUsePremium ? null : sub ? "fair_use" : "no_credits";
  return {
    canUsePremium,
    blockedReason,
    credits,
    subscription: sub ? toView(sub) : null,
    resetsAt: blockedReason === "fair_use" && sub ? sub.periodEnd : null,
  };
}

// --- Reservations -------------------------------------------------------------

export type Reservation = { id: string; fundedBy: "subscription" | "credits" };
export type ReserveResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; code: PremiumBlock; resetsAt?: string }
  | { ok: false; code: "in_progress" }
  | { ok: false; code: "replay"; verdictId: string };

async function existingByKey(
  db: Client,
  userId: string,
  key: string,
): Promise<{ status: string; verdictId: string | null } | null> {
  const rs = await db.execute({
    sql: "SELECT status, verdict_id FROM premium_usage WHERE user_id = ? AND idempotency_key = ?",
    args: [userId, key],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return { status: String(row.status), verdictId: row.verdict_id == null ? null : String(row.verdict_id) };
}

/** The reservation a user made with this Idempotency-Key, if any (status:
 * reserved, consumed or refunded). */
export async function reservationByKey(
  userId: string,
  key: string,
): Promise<{ status: string; verdictId: string | null } | null> {
  return existingByKey(await client(), userId, key);
}

function keyOutcome(existing:{ status: string; verdictId: string | null }): ReserveResult | null {
  if (existing.status === "reserved") return { ok: false, code: "in_progress" };
  if (existing.status === "consumed" && existing.verdictId) {
    return { ok: false, code: "replay", verdictId: existing.verdictId };
  }
  return null; // refunded: the key may be used again
}

/**
 * Takes one premium unit before any model call: from an active subscription
 * under its cap first, else one credit. Consume it on success, refund it on
 * failure. With an Idempotency-Key, a retry of a running request answers
 * in_progress and a retry of a finished one answers replay (no charge).
 */
export async function reservePremiumVerdict(
  userId: string,
  opts: { idempotencyKey?: string; now?: Date } = {},
): Promise<ReserveResult> {
  const now = opts.now ?? new Date();
  const nowIso = iso(now);
  const key = opts.idempotencyKey || null;
  await maybeSweep(now);
  const db = await client();

  if (key) {
    const existing = await existingByKey(db, userId, key);
    const outcome = existing && keyOutcome(existing);
    if (outcome) return outcome;
  }

  const subs = await activeSubscriptions(db, userId, nowIso);
  const candidate = subs.find((s) => s.used < s.cap) ?? null;
  const id = nanoid(16);

  const stmts: InStatement[] = [];
  if (key) {
    // A refunded attempt frees its key for the retry.
    stmts.push({
      sql: "UPDATE premium_usage SET idempotency_key = NULL WHERE user_id = ? AND idempotency_key = ? AND status = 'refunded'",
      args: [userId, key],
    });
  }
  // 1. Subscription unit, if the candidate is still active and under its cap.
  stmts.push({
    sql: `UPDATE subscriptions SET used_in_period = used_in_period + 1, updated_at = ?
          WHERE id = ? AND user_id = ? AND status = 'active' AND period_start <= ? AND period_end > ?
            AND used_in_period < cap`,
    args: [nowIso, candidate?.id ?? "", userId, nowIso, nowIso],
  });
  const subInsertIndex = stmts.length;
  stmts.push({
    sql: `INSERT INTO premium_usage
            (id, user_id, idempotency_key, funded_by, subscription_id, sub_period_end, status, created_at, updated_at)
          SELECT ?, ?, ?, 'subscription', id, period_end, 'reserved', ?, ?
          FROM subscriptions WHERE id = ? AND changes() = 1`,
    args: [id, userId, key, nowIso, nowIso, candidate?.id ?? ""],
  });
  // 2. Otherwise one credit.
  stmts.push({
    sql: `UPDATE entitlement_accounts SET credits = credits - 1, updated_at = ?
          WHERE user_id = ? AND credits > 0 AND NOT EXISTS (SELECT 1 FROM premium_usage WHERE id = ?)`,
    args: [nowIso, userId, id],
  });
  const creditInsertIndex = stmts.length;
  stmts.push({
    sql: `INSERT INTO premium_usage
            (id, user_id, idempotency_key, funded_by, subscription_id, sub_period_end, status, created_at, updated_at)
          SELECT ?, ?, ?, 'credits', NULL, NULL, 'reserved', ?, ? WHERE changes() = 1`,
    args: [id, userId, key, nowIso, nowIso],
  });

  let results: ResultSet[];
  try {
    results = await writeBatch(stmts);
  } catch (e) {
    // A concurrent request with the same key won the insert.
    if (key && isUniqueViolation(e)) {
      const existing = await existingByKey(db, userId, key);
      return (existing && keyOutcome(existing)) ?? { ok: false, code: "in_progress" };
    }
    throw e;
  }
  if (results[subInsertIndex].rowsAffected === 1) {
    return { ok: true, reservation: { id, fundedBy: "subscription" } };
  }
  if (results[creditInsertIndex].rowsAffected === 1) {
    return { ok: true, reservation: { id, fundedBy: "credits" } };
  }
  const ent = await getEntitlement(userId, now);
  const code = ent.blockedReason ?? "premium_required";
  return code === "fair_use" && ent.resetsAt
    ? { ok: false, code, resetsAt: ent.resetsAt }
    : { ok: false, code };
}

/** Marks a reservation as spent on `verdictId`. No-op unless still reserved. */
export async function consumePremiumVerdict(reservationId: string, verdictId: string): Promise<void> {
  await writeBatch([
    {
      sql: `UPDATE premium_usage SET status = 'consumed', verdict_id = ?, updated_at = ?
            WHERE id = ? AND status = 'reserved'`,
      args: [verdictId, iso(new Date()), reservationId],
    },
  ]);
}

/** Returns the unit to where it came from. No-op unless still reserved. A
 * subscription unit is only returned while the same period is running. */
async function refund(reservationId: string, now: Date): Promise<boolean> {
  const results = await writeBatch(refundStatements(reservationId, iso(now)));
  return results[2].rowsAffected === 1;
}

export async function refundPremiumVerdict(reservationId: string): Promise<void> {
  await refund(reservationId, new Date());
}

/** Refunds reservations left `reserved` for over 10 minutes (a crashed or
 * killed request) after their creation, or after `hold_until` when one is
 * set (a case waiting for its answer). Returns how many were refunded. */
export async function sweepStaleReservations(now: Date = new Date()): Promise<number> {
  globalForEntitlements.__verdictEntitlementsLastSweep = now.getTime();
  const db = await client();
  const rs = await db.execute({
    sql: "SELECT id FROM premium_usage WHERE status = 'reserved' AND COALESCE(hold_until, created_at) < ? LIMIT 200",
    args: [iso(new Date(now.getTime() - STALE_RESERVATION_MS))],
  });
  let refunded = 0;
  for (const row of rs.rows) {
    if (await refund(String(row.id), now)) refunded += 1;
  }
  return refunded;
}

async function maybeSweep(now: Date): Promise<void> {
  const last = globalForEntitlements.__verdictEntitlementsLastSweep;
  if (last !== undefined && Math.abs(now.getTime() - last) < SWEEP_EVERY_MS) return;
  try {
    await sweepStaleReservations(now);
  } catch (e) {
    console.error("[entitlements] stale reservation sweep failed:", e instanceof Error ? e.message : e);
  }
}

/** Site-wide premium pipeline runs started since 00:00 UTC. Refunded ones
 * count too: a refused or failed run still paid for its model calls. */
export async function countPremiumToday(now: Date = new Date()): Promise<number> {
  const db = await client();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const rs = await db.execute({
    sql: "SELECT count(*) AS n FROM premium_usage WHERE created_at >= ?",
    args: [iso(dayStart)],
  });
  return Number(rs.rows[0]?.n ?? 0);
}

// --- Grants (admin, stores, web payments) -------------------------------------

/** false = a duplicate (source, externalId), or nothing to apply it to. */
export type GrantResult = { applied: boolean };

export async function grantCredits(g: {
  userId: string;
  credits: number;
  source: GrantSource;
  externalId: string;
  productId?: string;
  note?: string;
}): Promise<GrantResult> {
  assertSource(g.source);
  assertId(g.userId, "userId");
  assertId(g.externalId, "externalId");
  if (!Number.isInteger(g.credits) || g.credits <= 0 || g.credits > 100_000) {
    throw new Error("credits must be a positive integer");
  }
  const id = nanoid();
  const nowIso = iso(new Date());
  const guard = grantExists(id);
  const results = await writeBatch([
    {
      sql: `INSERT INTO entitlement_grants
              (id, user_id, source, external_id, kind, product_id, credits_delta, note, created_at)
            VALUES (?, ?, ?, ?, 'credits', ?, ?, ?, ?)
            ON CONFLICT (source, external_id) DO NOTHING`,
      args: [id, g.userId, g.source, g.externalId, g.productId ?? null, g.credits, g.note ?? null, nowIso],
    },
    {
      sql: `INSERT INTO entitlement_accounts (user_id, credits, updated_at)
            SELECT ?, ?, ? WHERE ${guard.sql}
            ON CONFLICT (user_id) DO UPDATE SET credits = credits + excluded.credits, updated_at = excluded.updated_at`,
      args: [g.userId, g.credits, nowIso, ...guard.args],
    },
  ]);
  return { applied: results[0].rowsAffected === 1 };
}

/** Premium verdicts every new account starts with. */
export const WELCOME_CREDITS = 1;

/** The new account's welcome credit, once per `claim` (welcomeClaim of the
 * email in lib/auth) and once per account. */
export async function grantWelcomeCredit(userId: string, claim: string): Promise<GrantResult> {
  assertId(userId, "userId");
  const id = nanoid();
  const nowIso = iso(new Date());
  const guard = grantExists(id);
  const results = await writeBatch([
    {
      sql: "INSERT INTO welcome_claims (claim, created_at) VALUES (?, ?) ON CONFLICT (claim) DO NOTHING",
      args: [claim, nowIso],
    },
    {
      sql: `INSERT INTO entitlement_grants
              (id, user_id, source, external_id, kind, credits_delta, note, created_at)
            SELECT ?, ?, 'promo', ?, 'credits', ?, 'welcome', ? WHERE changes() = 1
            ON CONFLICT (source, external_id) DO NOTHING`,
      args: [id, userId, `welcome:${userId}`, WELCOME_CREDITS, nowIso],
    },
    {
      sql: `INSERT INTO entitlement_accounts (user_id, credits, updated_at)
            SELECT ?, ?, ? WHERE ${guard.sql}
            ON CONFLICT (user_id) DO UPDATE SET credits = credits + excluded.credits, updated_at = excluded.updated_at`,
      args: [userId, WELCOME_CREDITS, nowIso, ...guard.args],
    },
  ]);
  return { applied: results[1].rowsAffected === 1 };
}

/** The welcome credit of an account whose grant at sign-up never landed (a
 * failed write, or a restart right after the user row). Only for accounts
 * made since the first welcome credit went out, so older ones still get
 * nothing, and only while the email has no claim. */
export async function grantMissedWelcomeCredit(userId: string, claim: string, createdAt: Date): Promise<GrantResult> {
  const db = await client();
  const rs = await db.execute({
    sql: `SELECT (SELECT min(created_at) FROM welcome_claims) AS since,
                 EXISTS (SELECT 1 FROM welcome_claims WHERE claim = ?) AS claimed`,
    args: [claim],
  });
  const row = rs.rows[0];
  if (row?.since == null || Number(row.claimed) === 1 || iso(createdAt) < String(row.since)) {
    return { applied: false };
  }
  return grantWelcomeCredit(userId, claim);
}

/**
 * Starts or renews a subscription, keyed by (source, originalTransactionId).
 * A new periodStart resets the period's usage. An event for an older period
 * than the stored active one is recorded but does not roll the period back.
 */
export async function grantSubscription(g: {
  userId: string;
  source: GrantSource;
  externalId: string;
  originalTransactionId: string;
  productId: string;
  periodStart: string;
  periodEnd: string;
  willRenew: boolean;
  cap?: number;
}): Promise<GrantResult> {
  assertSource(g.source);
  assertId(g.userId, "userId");
  assertId(g.externalId, "externalId");
  assertId(g.originalTransactionId, "originalTransactionId");
  assertId(g.productId, "productId");
  const periodStart = normalizeIso(g.periodStart, "periodStart");
  const periodEnd = normalizeIso(g.periodEnd, "periodEnd");
  if (periodEnd <= periodStart) throw new Error("periodEnd must be after periodStart");
  const cap = g.cap ?? PRICING.monthly.fairUseCap;
  if (!Number.isInteger(cap) || cap < 0) throw new Error("cap must be a non-negative integer");

  const id = nanoid();
  const subId = nanoid();
  const nowIso = iso(new Date());
  const guard = grantExists(id);
  const results = await writeBatch([
    {
      sql: `INSERT INTO entitlement_grants (id, user_id, source, external_id, kind, product_id, created_at)
            VALUES (?, ?, ?, ?, 'subscription_active', ?, ?)
            ON CONFLICT (source, external_id) DO NOTHING`,
      args: [id, g.userId, g.source, g.externalId, g.productId, nowIso],
    },
    {
      sql: `INSERT INTO subscriptions
              (id, user_id, source, original_transaction_id, product_id, status, period_start, period_end,
               will_renew, cap, used_in_period, updated_at)
            SELECT ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 0, ? WHERE ${guard.sql}
            ON CONFLICT (source, original_transaction_id) DO UPDATE SET
              user_id = excluded.user_id,
              product_id = excluded.product_id,
              status = 'active',
              will_renew = excluded.will_renew,
              cap = excluded.cap,
              used_in_period = CASE WHEN subscriptions.period_start = excluded.period_start
                                    THEN subscriptions.used_in_period ELSE 0 END,
              period_start = excluded.period_start,
              period_end = excluded.period_end,
              updated_at = excluded.updated_at
            WHERE subscriptions.status <> 'active' OR excluded.period_end >= subscriptions.period_end`,
      args: [
        subId,
        g.userId,
        g.source,
        g.originalTransactionId,
        g.productId,
        periodStart,
        periodEnd,
        g.willRenew ? 1 : 0,
        cap,
        nowIso,
        ...guard.args,
      ],
    },
    {
      sql: `UPDATE entitlement_grants SET subscription_id =
              (SELECT id FROM subscriptions WHERE source = ? AND original_transaction_id = ?)
            WHERE id = ?`,
      args: [g.source, g.originalTransactionId, id],
    },
  ]);
  return { applied: results[0].rowsAffected === 1 };
}

/** Records an existing subscription event (no new user id needed): the grant
 * row takes user and product from the subscription. */
function subscriptionEventGrant(
  id: string,
  kind: string,
  g: { source: GrantSource; externalId: string; originalTransactionId: string },
  nowIso: string,
): InStatement {
  return {
    sql: `INSERT INTO entitlement_grants
            (id, user_id, source, external_id, kind, product_id, subscription_id, created_at)
          SELECT ?, user_id, ?, ?, ?, product_id, id, ?
          FROM subscriptions WHERE source = ? AND original_transaction_id = ?
          ON CONFLICT (source, external_id) DO NOTHING`,
    args: [id, g.source, g.externalId, kind, nowIso, g.source, g.originalTransactionId],
  };
}

/** Auto-renew turned off (access stays until periodEnd) or back on. */
export async function setSubscriptionWillRenew(g: {
  source: GrantSource;
  externalId: string;
  originalTransactionId: string;
  willRenew: boolean;
}): Promise<GrantResult> {
  assertSource(g.source);
  assertId(g.externalId, "externalId");
  assertId(g.originalTransactionId, "originalTransactionId");
  const id = nanoid();
  const nowIso = iso(new Date());
  const guard = grantExists(id);
  const kind = g.willRenew ? "subscription_active" : "subscription_will_not_renew";
  const results = await writeBatch([
    subscriptionEventGrant(id, kind, g, nowIso),
    {
      sql: `UPDATE subscriptions SET will_renew = ?, updated_at = ?
            WHERE source = ? AND original_transaction_id = ? AND ${guard.sql}`,
      args: [g.willRenew ? 1 : 0, nowIso, g.source, g.originalTransactionId, ...guard.args],
    },
  ]);
  return { applied: results[0].rowsAffected === 1 };
}

/** The subscription ended at `at`. Ignored when a renewal for a later period
 * was already applied (out-of-order webhooks). */
export async function expireSubscription(g: {
  source: GrantSource;
  externalId: string;
  originalTransactionId: string;
  at: string;
}): Promise<GrantResult> {
  assertSource(g.source);
  assertId(g.externalId, "externalId");
  assertId(g.originalTransactionId, "originalTransactionId");
  const at = normalizeIso(g.at, "at");
  const id = nanoid();
  const nowIso = iso(new Date());
  const guard = grantExists(id);
  const results = await writeBatch([
    subscriptionEventGrant(id, "subscription_expired", g, nowIso),
    {
      sql: `UPDATE subscriptions
            SET status = 'expired', will_renew = 0, period_end = MIN(period_end, ?), updated_at = ?
            WHERE source = ? AND original_transaction_id = ? AND status = 'active' AND period_start <= ?
              AND ${guard.sql}`,
      args: [at, nowIso, g.source, g.originalTransactionId, at, ...guard.args],
    },
  ]);
  return { applied: results[0].rowsAffected === 1 };
}

/**
 * A store or provider refunded a purchase. `transactionId` is the credit
 * purchase's transaction id (the externalId it was granted with) or a
 * subscription's original transaction id. Credits: deducts what was granted,
 * at most the current balance (never below 0). Subscription: status
 * "refunded", premium stops at once. Each purchase is refunded at most once.
 */
export async function refundPurchase(g: {
  source: GrantSource;
  externalId: string;
  transactionId: string;
}): Promise<GrantResult> {
  assertSource(g.source);
  assertId(g.externalId, "externalId");
  assertId(g.transactionId, "transactionId");
  const creditId = nanoid();
  const subGrantId = nanoid();
  const nowIso = iso(new Date());
  const results = await writeBatch([
    {
      sql: `INSERT INTO entitlement_grants
              (id, user_id, source, external_id, kind, product_id, credits_delta, ref_external_id, created_at)
            SELECT ?, g.user_id, g.source, ?, 'refund', g.product_id,
                   -MIN(g.credits_delta, COALESCE(a.credits, 0)), g.external_id, ?
            FROM entitlement_grants g LEFT JOIN entitlement_accounts a ON a.user_id = g.user_id
            WHERE g.source = ? AND g.external_id = ? AND g.kind = 'credits'
              AND NOT EXISTS (SELECT 1 FROM entitlement_grants r
                              WHERE r.kind = 'refund' AND r.source = g.source AND r.ref_external_id = g.external_id)
            ON CONFLICT (source, external_id) DO NOTHING`,
      args: [creditId, g.externalId, nowIso, g.source, g.transactionId],
    },
    {
      sql: `UPDATE entitlement_accounts
            SET credits = MAX(credits + (SELECT credits_delta FROM entitlement_grants WHERE id = ?), 0),
                updated_at = ?
            WHERE user_id = (SELECT user_id FROM entitlement_grants WHERE id = ?)`,
      args: [creditId, nowIso, creditId],
    },
    {
      sql: `INSERT INTO entitlement_grants
              (id, user_id, source, external_id, kind, product_id, subscription_id, ref_external_id, created_at)
            SELECT ?, s.user_id, s.source, ?, 'refund', s.product_id, s.id, s.original_transaction_id, ?
            FROM subscriptions s
            WHERE s.source = ? AND s.original_transaction_id = ? AND s.status <> 'refunded'
            ON CONFLICT (source, external_id) DO NOTHING`,
      args: [subGrantId, g.externalId, nowIso, g.source, g.transactionId],
    },
    {
      sql: `UPDATE subscriptions SET status = 'refunded', will_renew = 0, updated_at = ?
            WHERE id = (SELECT subscription_id FROM entitlement_grants WHERE id = ?)`,
      args: [nowIso, subGrantId],
    },
  ]);
  return { applied: results[0].rowsAffected + results[2].rowsAffected > 0 };
}

/** Admin: zero the credits and revoke every active subscription. */
export async function revokeAll(
  userId: string,
  opts: { externalId: string; note?: string },
): Promise<GrantResult> {
  assertId(userId, "userId");
  assertId(opts.externalId, "externalId");
  const id = nanoid();
  const nowIso = iso(new Date());
  const guard = grantExists(id);
  const results = await writeBatch([
    {
      sql: `INSERT INTO entitlement_grants
              (id, user_id, source, external_id, kind, credits_delta, note, created_at)
            SELECT ?, ?, 'admin', ?, 'revoke',
                   -COALESCE((SELECT credits FROM entitlement_accounts WHERE user_id = ?), 0), ?, ?
            WHERE true
            ON CONFLICT (source, external_id) DO NOTHING`,
      args: [id, userId, opts.externalId, userId, opts.note ?? null, nowIso],
    },
    {
      sql: `UPDATE entitlement_accounts SET credits = 0, updated_at = ? WHERE user_id = ? AND ${guard.sql}`,
      args: [nowIso, userId, ...guard.args],
    },
    {
      sql: `UPDATE subscriptions SET status = 'revoked', will_renew = 0, updated_at = ?
            WHERE user_id = ? AND status = 'active' AND ${guard.sql}`,
      args: [nowIso, userId, ...guard.args],
    },
  ]);
  return { applied: results[0].rowsAffected === 1 };
}

/** Account deletion: removes every entitlement row of the user. The
 * reservations stay, cut loose from the account and the verdict, because
 * the site-wide daily cap counts them. */
export async function deleteUserEntitlements(userId: string): Promise<void> {
  await writeBatch([
    {
      sql: `UPDATE premium_usage SET user_id = '', idempotency_key = NULL, verdict_id = NULL, subscription_id = NULL
            WHERE user_id = ?`,
      args: [userId],
    },
    { sql: "DELETE FROM subscriptions WHERE user_id = ?", args: [userId] },
    { sql: "DELETE FROM entitlement_grants WHERE user_id = ?", args: [userId] },
    { sql: "DELETE FROM entitlement_accounts WHERE user_id = ?", args: [userId] },
  ]);
}

// --- Normalized purchase events ---------------------------------------------

/** Normalized purchase event: the single entry point for purchase webhooks
 * (RevenueCat in app/api/v1/webhooks/revenuecat, a future web provider). */
export type StoreEvent =
  | {
      type: "credits_purchased";
      eventId: string;
      source: GrantSource;
      userId: string;
      productId: string;
      credits: number;
      transactionId: string;
    }
  | {
      type: "subscription_active";
      eventId: string;
      source: GrantSource;
      userId: string;
      productId: string;
      originalTransactionId: string;
      periodStart: string;
      periodEnd: string;
      willRenew: boolean;
    }
  | { type: "subscription_will_not_renew"; eventId: string; source: GrantSource; originalTransactionId: string }
  | { type: "subscription_expired"; eventId: string; source: GrantSource; originalTransactionId: string; at: string }
  | { type: "refund"; eventId: string; source: GrantSource; transactionId: string };

/**
 * Applies one purchase event exactly once. Credit purchases are keyed by
 * their transaction id (so the same purchase reported by two events is
 * granted once, and a refund can find it); subscription events by event id.
 */
export async function applyStoreEvent(e: StoreEvent): Promise<GrantResult> {
  switch (e.type) {
    case "credits_purchased":
      return grantCredits({
        userId: e.userId,
        credits: e.credits,
        source: e.source,
        externalId: e.transactionId,
        productId: e.productId,
        note: `event ${e.eventId}`,
      });
    case "subscription_active":
      return grantSubscription({
        userId: e.userId,
        source: e.source,
        externalId: e.eventId,
        originalTransactionId: e.originalTransactionId,
        productId: e.productId,
        periodStart: e.periodStart,
        periodEnd: e.periodEnd,
        willRenew: e.willRenew,
      });
    case "subscription_will_not_renew":
      return setSubscriptionWillRenew({
        source: e.source,
        externalId: e.eventId,
        originalTransactionId: e.originalTransactionId,
        willRenew: false,
      });
    case "subscription_expired":
      return expireSubscription({
        source: e.source,
        externalId: e.eventId,
        originalTransactionId: e.originalTransactionId,
        at: e.at,
      });
    case "refund":
      return refundPurchase({ source: e.source, externalId: e.eventId, transactionId: e.transactionId });
  }
}
