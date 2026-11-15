/**
 * Training consent and "Fair verdict?" ratings. Server only.
 *
 * - consent_ledger: one row per choice (card answer or switch change) or
 *   agreement, kept as proof. It records the account, the choice, the policy
 *   version in force, the wording key, the language and the text shown in
 *   it, and the platform. `kind` is 'training' (Help improve Judge) or
 *   'sensitive' (the one-time agreement that a person's text may hold
 *   private details). Triggers refuse every update and delete, except two:
 *   deleting an account swaps its id for a random placeholder (the same on
 *   all its rows) and stamps `unlinked_at`, and a row may be deleted six
 *   years after that. A signed-out respondent's agreement is stored under
 *   'guest:<case>:<party>' with `unlinked_at` set at once.
 * - consent_state: the account's current choice. No row means not asked yet;
 *   a row, either way, means the card is never shown again.
 * - verdict_ratings: one row per (verdict, account). Clearing a rating sets
 *   it to NULL; the row stays. training_ok_at is set when the rating was
 *   given with consent on; turning consent off sets training_withdrawn_at.
 *
 * A verdict is eligible for training when verdict_meta.training_ok_at is set
 * (its writer, and for a case every party, had consent on when it was made),
 * training_withdrawn_at is NULL, and it is not removed or erased.
 */

import type { Client, InStatement } from "@libsql/client";
import { getDb } from "@/lib/db";
import { entitlementWriteBatch } from "@/lib/entitlements";
import type { Lang } from "@/lib/langs";
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
    lang            TEXT NOT NULL DEFAULT 'en',
    platform        TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
    kind            TEXT NOT NULL DEFAULT 'training',
    unlinked_at     TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS consent_ledger_user ON consent_ledger (user_id, id)",
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
    training_ok_at         TEXT,
    training_withdrawn_at  TEXT,
    PRIMARY KEY (verdict_id, user_id)
  )`,
];

/** The ledger's only two exceptions to append-only: the move to a placeholder
 * id (nothing else about the row changes), and the delete six years later.
 * Replaces the plain no-update and no-delete triggers in one batch, so the
 * table is never unguarded. */
const LEDGER_GUARDS = [
  "DROP TRIGGER IF EXISTS consent_ledger_no_update",
  "DROP TRIGGER IF EXISTS consent_ledger_no_delete",
  `CREATE TRIGGER IF NOT EXISTS consent_ledger_guard_update BEFORE UPDATE ON consent_ledger
    WHEN NOT (
      OLD.user_id NOT GLOB 'deleted:*' AND NEW.user_id GLOB 'deleted:*'
      AND OLD.unlinked_at IS NULL AND NEW.unlinked_at IS NOT NULL
      AND NEW.id IS OLD.id AND NEW.kind IS OLD.kind AND NEW.choice IS OLD.choice AND NEW.source IS OLD.source
      AND NEW.at IS OLD.at AND NEW.policy_version IS OLD.policy_version AND NEW.wording_key IS OLD.wording_key
      AND NEW.wording_text IS OLD.wording_text AND NEW.lang IS OLD.lang AND NEW.platform IS OLD.platform)
    BEGIN SELECT RAISE(ABORT, 'consent_ledger is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS consent_ledger_guard_delete BEFORE DELETE ON consent_ledger
    WHEN OLD.unlinked_at IS NULL OR OLD.unlinked_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 years')
    BEGIN SELECT RAISE(ABORT, 'consent_ledger is append-only'); END`,
];

const globalForFeedback = globalThis as unknown as {
  __judgeFeedbackReady?: { client: Client; ready: Promise<void> };
};

async function addColumns(client: Client): Promise<void> {
  const added: [string, string, string][] = [
    ["verdict_ratings", "training_ok_at", "TEXT"],
    ["verdict_ratings", "training_withdrawn_at", "TEXT"],
    ["consent_ledger", "lang", "TEXT NOT NULL DEFAULT 'en'"],
    ["consent_ledger", "kind", "TEXT NOT NULL DEFAULT 'training'"],
    ["consent_ledger", "unlinked_at", "TEXT"],
  ];
  for (const [table, name, type] of added) {
    const info = await client.execute(`PRAGMA table_info(${table})`);
    if (info.rows.some((r) => String(r.name) === name)) continue;
    try {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    } catch (e) {
      if (!/duplicate column name/i.test(e instanceof Error ? e.message : String(e))) throw e;
    }
  }
}

/** Creates the consent and rating tables once per process. Idempotent. */
export async function ensureFeedbackTables(): Promise<void> {
  const client = await getDb();
  const cached = globalForFeedback.__judgeFeedbackReady;
  if (cached?.client === client) return cached.ready;
  const ready = client
    .batch(SCHEMA, "write")
    .then(() => addColumns(client))
    .then(() => client.batch(LEDGER_GUARDS, "write"))
    .then(
      () => undefined,
      (e: unknown) => {
        globalForFeedback.__judgeFeedbackReady = undefined;
        throw e;
      },
    );
  globalForFeedback.__judgeFeedbackReady = { client, ready };
  return ready;
}

export type ConsentView = {
  state: ConsentState;
  updatedAt: string | null;
  policyVersion: string;
};

export async function getConsent(userId: string): Promise<ConsentView> {
  await ensureFeedbackTables();
  const db = await getDb();
  const rs = await db.execute({
    sql: "SELECT choice, updated_at FROM consent_state WHERE user_id = ?",
    args: [userId],
  });
  const row = rs.rows[0];
  return row
    ? {
        state: String(row.choice) as ConsentChoice,
        updatedAt: String(row.updated_at),
        policyVersion: POLICY_VERSION,
      }
    : { state: "not_asked", updatedAt: null, policyVersion: POLICY_VERSION };
}

export type ConsentRecord = {
  choice: ConsentChoice;
  source: ConsentSource;
  wordingKey: string;
  wordingText: string;
  lang: Lang;
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
      sql: `INSERT INTO consent_ledger (user_id, choice, source, at, policy_version, wording_key, wording_text, lang, platform)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [userId, rec.choice, rec.source, nowIso, POLICY_VERSION, rec.wordingKey, rec.wordingText, rec.lang, rec.platform],
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
  return {
    state: rec.choice,
    updatedAt: nowIso,
    policyVersion: POLICY_VERSION,
  };
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
    ratingWithdrawStatement(userId, nowIso),
  ];
}

/** Withdraws the account's ratings from training. */
export function ratingWithdrawStatement(userId: string, nowIso: string): InStatement {
  return {
    sql: `UPDATE verdict_ratings SET training_withdrawn_at = ?
          WHERE user_id = ? AND training_ok_at IS NOT NULL AND training_withdrawn_at IS NULL`,
    args: [nowIso, userId],
  };
}

/** True unless the verdict (`?`) is a round of added context whose first
 * verdict or an earlier round is not eligible: its input holds their text. */
const ROUNDS_ELIGIBLE = `NOT EXISTS (
  SELECT 1 FROM verdict_appeals me WHERE me.id = ? AND (
    NOT EXISTS (SELECT 1 FROM verdict_meta rm WHERE rm.verdict_id = me.verdict_id
      AND rm.training_ok_at IS NOT NULL AND rm.training_withdrawn_at IS NULL)
    OR EXISTS (
      SELECT 1 FROM verdict_appeals o JOIN verdicts ov ON ov.id = o.id
      WHERE o.verdict_id = me.verdict_id AND o.id <> me.id AND o.created_at < me.created_at
        AND NOT EXISTS (SELECT 1 FROM verdict_meta om WHERE om.verdict_id = o.id
          AND om.training_ok_at IS NOT NULL AND om.training_withdrawn_at IS NULL))))`;

/** Marks a new one-sided verdict as usable for training, only when its
 * writer's consent is on right now (evaluated inside the saving batch). A
 * round also needs the verdicts before it to be eligible. */
export function oneSidedStampStatement(verdictId: string, userId: string, nowIso: string): InStatement {
  return {
    sql: `UPDATE verdict_meta SET training_ok_at = ?
          WHERE verdict_id = ? AND EXISTS (SELECT 1 FROM consent_state WHERE user_id = ? AND choice = 'on')
            AND ${ROUNDS_ELIGIBLE}`,
    args: [nowIso, verdictId, userId, verdictId],
  };
}

/** The same for a case verdict: the owner and every party that wrote a side
 * must have consent on, and so must every earlier verdict of the case (an
 * appeal's input holds their text). A party with no account (or none bound
 * yet) has not consented. */
export function caseStampStatement(verdictId: string, caseId: string, nowIso: string): InStatement {
  return {
    sql: `UPDATE verdict_meta SET training_ok_at = ?
          WHERE verdict_id = ? AND kind = 'case'
            AND NOT EXISTS (
              SELECT 1 FROM case_verdicts o WHERE o.case_id = ? AND o.verdict_id <> ?
                AND NOT EXISTS (SELECT 1 FROM verdict_meta om WHERE om.verdict_id = o.verdict_id
                  AND om.training_ok_at IS NOT NULL AND om.training_withdrawn_at IS NULL))
            AND EXISTS (SELECT 1 FROM consent_state cs, cases c WHERE c.id = ? AND cs.user_id = c.owner_id AND cs.choice = 'on')
            AND NOT EXISTS (
              SELECT 1 FROM case_sides s JOIN cases c ON c.id = s.case_id
              WHERE s.case_id = ? AND NOT EXISTS (
                SELECT 1 FROM consent_state cs WHERE cs.choice = 'on' AND cs.user_id = CASE s.party
                  WHEN 'a' THEN c.owner_id
                  WHEN 'b' THEN c.respondent_user_id
                  ELSE (SELECT i.user_id FROM case_invites i WHERE i.case_id = c.id AND i.party = s.party) END))`,
    args: [nowIso, verdictId, caseId, verdictId, caseId, caseId],
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
      sql: `INSERT INTO verdict_ratings (verdict_id, user_id, rating, created_at, updated_at, training_ok_at)
            SELECT ?, ?, ?, ?, ?, CASE WHEN EXISTS (SELECT 1 FROM consent_state WHERE user_id = ? AND choice = 'on') THEN ? END
            WHERE true
            ON CONFLICT(verdict_id, user_id) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at,
              training_ok_at = excluded.training_ok_at, training_withdrawn_at = NULL`,
      args: [verdictId, userId, rating, nowIso, nowIso, userId, nowIso],
    },
  ]);
}
