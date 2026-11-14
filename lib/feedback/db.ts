/**
 * Training consent and "Fair verdict?" ratings. Server only.
 *
 * - consent_ledger: one row per choice (card answer or switch change), never
 *   updated or deleted (triggers refuse both). It records the account, the
 *   choice, the policy version in force, the wording key and the English
 *   text shown, and the platform.
 * - consent_state: the account's current choice. No row means not asked yet;
 *   a row, either way, means the card is never shown again.
 * - verdict_ratings: one row per (verdict, account). Clearing a rating sets
 *   it to NULL; the row stays.
 *
 * A verdict is eligible for training when verdict_meta.training_ok_at is set
 * (its writer, and for a case every party, had consent on when it was made),
 * training_withdrawn_at is NULL, and it is not removed or erased.
 */

import type { Client, InStatement } from "@libsql/client";
import { getDb } from "@/lib/db";
import { entitlementWriteBatch } from "@/lib/entitlements";
import { POLICY_VERSION } from "@/lib/policy";

export type ConsentChoice = "on" | "off";
export type ConsentSource = "card" | "switch";
export type ConsentPlatform = "ios" | "android" | "web";
export type ConsentState = ConsentChoice | "not_asked";
export type Rating = "up" | "down";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS consent_ledger (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL,
    choice          TEXT NOT NULL CHECK (choice IN ('on','off')),
    source          TEXT NOT NULL CHECK (source IN ('card','switch')),
    at              TEXT NOT NULL,
    policy_version  TEXT NOT NULL,
    wording_key     TEXT NOT NULL,
    wording_text    TEXT NOT NULL,
    platform        TEXT NOT NULL CHECK (platform IN ('ios','android','web'))
  )`,
  "CREATE INDEX IF NOT EXISTS consent_ledger_user ON consent_ledger (user_id, id)",
  `CREATE TRIGGER IF NOT EXISTS consent_ledger_no_update BEFORE UPDATE ON consent_ledger
    BEGIN SELECT RAISE(ABORT, 'consent_ledger is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS consent_ledger_no_delete BEFORE DELETE ON consent_ledger
    BEGIN SELECT RAISE(ABORT, 'consent_ledger is append-only'); END`,
  `CREATE TABLE IF NOT EXISTS consent_state (
    user_id         TEXT PRIMARY KEY,
    choice          TEXT NOT NULL CHECK (choice IN ('on','off')),
    asked_at        TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    policy_version  TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS verdict_ratings (
    verdict_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    rating      TEXT CHECK (rating IN ('up','down')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (verdict_id, user_id)
  )`,
];

const globalForFeedback = globalThis as unknown as {
  __judgeFeedbackReady?: { client: Client; ready: Promise<void> };
};

/** Creates the consent and rating tables once per process. Idempotent. */
export async function ensureFeedbackTables(): Promise<void> {
  const client = await getDb();
  const cached = globalForFeedback.__judgeFeedbackReady;
  if (cached?.client === client) return cached.ready;
  const ready = client.batch(SCHEMA, "write").then(
    () => undefined,
    (e: unknown) => {
      globalForFeedback.__judgeFeedbackReady = undefined;
      throw e;
    },
  );
  globalForFeedback.__judgeFeedbackReady = { client, ready };
  return ready;
}

export type ConsentView = { state: ConsentState; updatedAt: string | null; policyVersion: string };

export async function getConsent(userId: string): Promise<ConsentView> {
  await ensureFeedbackTables();
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT choice, updated_at FROM consent_state WHERE user_id = ?", args: [userId] });
  const row = rs.rows[0];
  return row
    ? { state: String(row.choice) as ConsentChoice, updatedAt: String(row.updated_at), policyVersion: POLICY_VERSION }
    : { state: "not_asked", updatedAt: null, policyVersion: POLICY_VERSION };
}

export type ConsentRecord = {
  choice: ConsentChoice;
  source: ConsentSource;
  wordingKey: string;
  wordingText: string;
  platform: ConsentPlatform;
};

/** Appends the ledger row, sets the account's current choice and, when it is
 * turned off, withdraws every verdict of the account that was stamped for
 * training: its own and the cases it is a party to. One batch. The caller
 * has ensured the originals tables (verdict_meta's training columns). */
export async function recordConsent(userId: string, rec: ConsentRecord, now: Date = new Date()): Promise<ConsentView> {
  await ensureFeedbackTables();
  const nowIso = now.toISOString();
  const stmts: InStatement[] = [
    {
      sql: `INSERT INTO consent_ledger (user_id, choice, source, at, policy_version, wording_key, wording_text, platform)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [userId, rec.choice, rec.source, nowIso, POLICY_VERSION, rec.wordingKey, rec.wordingText, rec.platform],
    },
    {
      sql: `INSERT INTO consent_state (user_id, choice, asked_at, updated_at, policy_version) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET choice = excluded.choice, updated_at = excluded.updated_at,
              policy_version = excluded.policy_version`,
      args: [userId, rec.choice, nowIso, nowIso, POLICY_VERSION],
    },
  ];
  if (rec.choice === "off") stmts.push(...withdrawStatements(userId, nowIso));
  await entitlementWriteBatch(stmts);
  return { state: rec.choice, updatedAt: nowIso, policyVersion: POLICY_VERSION };
}

function withdrawStatements(userId: string, nowIso: string): InStatement[] {
  const open = "training_ok_at IS NOT NULL AND training_withdrawn_at IS NULL";
  return [
    {
      sql: `UPDATE verdict_meta SET training_withdrawn_at = ? WHERE owner_user_id = ? AND ${open}`,
      args: [nowIso, userId],
    },
    {
      sql: `UPDATE verdict_meta SET training_withdrawn_at = ?
            WHERE kind = 'case' AND ${open} AND case_id IN (
              SELECT id FROM cases WHERE owner_id = ? OR respondent_user_id = ?
              UNION SELECT case_id FROM case_invites WHERE user_id = ?
              UNION SELECT case_id FROM case_seats WHERE user_id = ?)`,
      args: [nowIso, userId, userId, userId, userId],
    },
  ];
}

/** Marks a new one-sided verdict as usable for training, only when its
 * writer's consent is on right now (evaluated inside the saving batch). */
export function oneSidedStampStatement(verdictId: string, userId: string, nowIso: string): InStatement {
  return {
    sql: `UPDATE verdict_meta SET training_ok_at = ?
          WHERE verdict_id = ? AND EXISTS (SELECT 1 FROM consent_state WHERE user_id = ? AND choice = 'on')`,
    args: [nowIso, verdictId, userId],
  };
}

/** The same for a case verdict: the owner and every party that wrote a side
 * must have consent on. A party with no account (or none bound yet) has not
 * consented. */
export function caseStampStatement(verdictId: string, caseId: string, nowIso: string): InStatement {
  return {
    sql: `UPDATE verdict_meta SET training_ok_at = ?
          WHERE verdict_id = ? AND kind = 'case'
            AND EXISTS (SELECT 1 FROM consent_state cs, cases c WHERE c.id = ? AND cs.user_id = c.owner_id AND cs.choice = 'on')
            AND NOT EXISTS (
              SELECT 1 FROM case_sides s JOIN cases c ON c.id = s.case_id
              WHERE s.case_id = ? AND NOT EXISTS (
                SELECT 1 FROM consent_state cs WHERE cs.choice = 'on' AND cs.user_id = CASE s.party
                  WHEN 'a' THEN c.owner_id
                  WHEN 'b' THEN c.respondent_user_id
                  ELSE (SELECT i.user_id FROM case_invites i WHERE i.case_id = c.id AND i.party = s.party) END))`,
    args: [nowIso, verdictId, caseId, caseId],
  };
}

/** The account's own rating of each verdict it rated, by verdict id. */
export async function ratingsFor(userId: string, verdictIds: string[]): Promise<Record<string, Rating>> {
  if (verdictIds.length === 0) return {};
  await ensureFeedbackTables();
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT verdict_id, rating FROM verdict_ratings
          WHERE user_id = ? AND rating IS NOT NULL AND verdict_id IN (${verdictIds.map(() => "?").join(", ")})`,
    args: [userId, ...verdictIds],
  });
  return Object.fromEntries(rs.rows.map((r) => [String(r.verdict_id), String(r.rating) as Rating]));
}

/** Sets, changes or (null) clears the account's rating. */
export async function setRating(verdictId: string, userId: string, rating: Rating | null, now: Date = new Date()): Promise<void> {
  await ensureFeedbackTables();
  const nowIso = now.toISOString();
  await entitlementWriteBatch([
    {
      sql: `INSERT INTO verdict_ratings (verdict_id, user_id, rating, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(verdict_id, user_id) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`,
      args: [verdictId, userId, rating, nowIso, nowIso],
    },
  ]);
}
