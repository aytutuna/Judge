/**
 * Tables for stored originals and verdict ownership, and their reads.
 * Server only. Writes go through entitlementWriteBatch (serialized,
 * busy-retried, one atomic batch), like case and credit writes.
 *
 * - verdict_meta: one row per verdict created since this feature (and
 *   backfilled for case verdicts and premium verdicts, the only verdicts
 *   with a known owner): who owns it, whether names show on its share page,
 *   its sealed display names, whether the writer has saved them
 *   (names_confirmed_at: the share prompt is not shown again), and whether
 *   it was removed.
 * - originals: one sealed JSON blob per submission (a one-sided verdict, a
 *   case side, a case appeal). Blanked (NULL) on removal, never deleted.
 * - verdict_appeals: context the writer added to a one-sided verdict
 *   (anonymized). Its id is also the id of its verdict_jobs row and of the
 *   verdict it produces; its state is that job's (lib/verdict-appeals).
 *
 * A verdict without a verdict_meta row (free verdicts stored before this
 * feature) has no owner, is not removed and shows labels on its share page.
 */

import type { Client, Row } from "@libsql/client";
import { ensureCaseTables } from "@/lib/cases/db";
import { getDb } from "@/lib/db";
import type { RemovalReason } from "@/lib/originals-types";
import { VerdictResult } from "@/lib/types";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS verdict_meta (
    verdict_id        TEXT PRIMARY KEY,
    kind              TEXT NOT NULL CHECK (kind IN ('free','premium','case','legacy')),
    owner_user_id     TEXT,
    owner_token_hash  TEXT,
    case_id           TEXT,
    names_visible     INTEGER NOT NULL DEFAULT 1,
    display_sealed    TEXT,
    display_key_id    TEXT,
    names_confirmed_at TEXT,
    removed_at        TEXT,
    removal_reason    TEXT CHECK (removal_reason IN ('owner','party_a','party_b','account_deleted','operator')),
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS verdict_meta_token ON verdict_meta (owner_token_hash)
    WHERE owner_token_hash IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS verdict_meta_owner ON verdict_meta (owner_user_id, created_at)
    WHERE owner_user_id IS NOT NULL`,
  "CREATE INDEX IF NOT EXISTS verdict_meta_case ON verdict_meta (case_id) WHERE case_id IS NOT NULL",
  `CREATE TABLE IF NOT EXISTS originals (
    subject     TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('verdict','side','appeal')),
    verdict_id  TEXT,
    case_id     TEXT,
    party       TEXT CHECK (party IN ('a','b')),
    sealed      TEXT,
    key_id      TEXT,
    removed_at  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS originals_verdict ON originals (verdict_id) WHERE verdict_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS originals_case ON originals (case_id, party) WHERE case_id IS NOT NULL",
  `CREATE TABLE IF NOT EXISTS verdict_appeals (
    id          TEXT PRIMARY KEY,
    verdict_id  TEXT NOT NULL,
    text        TEXT NOT NULL,
    evidence    TEXT NOT NULL DEFAULT '[]',
    base_id     TEXT NOT NULL,
    outcome     TEXT CHECK (outcome IN ('upheld','overturned','changed')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS verdict_appeals_verdict ON verdict_appeals (verdict_id, created_at)",
];

/** Which party's removal a case verdict inherits (SQL over alias `c`). */
export const CASE_REMOVAL_REASON_SQL = `CASE WHEN c.removed_at IS NULL THEN NULL
  WHEN c.removed_a_at IS NOT NULL THEN 'party_a' WHEN c.removed_b_at IS NOT NULL THEN 'party_b' ELSE 'party_a' END`;

/** sqlite datetime('now') text -> ISO-8601 UTC (verdicts.created_at). */
const ISO_FROM_SQLITE = (col: string) => `strftime('%Y-%m-%dT%H:%M:%fZ', ${col})`;

/** Case verdicts first, so they are never labelled 'premium'. */
function backfillStatements(nowIso: string, userId: string | null = null) {
  const byUser = userId === null ? "" : " AND pu.user_id = ?";
  return [
    ...(userId === null
      ? [
          {
            sql: `INSERT OR IGNORE INTO verdict_meta
                    (verdict_id, kind, case_id, names_visible, removed_at, removal_reason, created_at, updated_at)
                  SELECT cv.verdict_id, 'case', cv.case_id, 1, c.removed_at, ${CASE_REMOVAL_REASON_SQL}, cv.created_at, ?
                  FROM case_verdicts cv JOIN cases c ON c.id = cv.case_id`,
            args: [nowIso],
          },
        ]
      : []),
    {
      sql: `INSERT OR IGNORE INTO verdict_meta (verdict_id, kind, owner_user_id, names_visible, created_at, updated_at)
            SELECT pu.verdict_id, 'premium', pu.user_id, 1, ${ISO_FROM_SQLITE("v.created_at")}, ?
            FROM premium_usage pu JOIN verdicts v ON v.id = pu.verdict_id
            WHERE pu.status = 'consumed' AND pu.verdict_id IS NOT NULL${byUser}
              AND NOT EXISTS (SELECT 1 FROM case_verdicts cv WHERE cv.verdict_id = pu.verdict_id)`,
      args: userId === null ? [nowIso] : [nowIso, userId],
    },
  ];
}

/** The legacy-premium backfill for one user (account deletion runs it in
 * its own batch, so premium verdicts saved without meta are removed too). */
export function userBackfillStatements(userId: string, nowIso: string) {
  return backfillStatements(nowIso, userId);
}

const globalForOriginals = globalThis as unknown as {
  __judgeOriginalsReady?: { client: Client; ready: Promise<void> };
};

/** Columns added to verdict_meta after its first version. */
const ADDED_META_COLUMNS: [string, string][] = [["names_confirmed_at", "TEXT"]];

async function addMetaColumns(db: Client): Promise<void> {
  const info = await db.execute("PRAGMA table_info(verdict_meta)");
  const have = new Set(info.rows.map((r) => String(r.name)));
  for (const [name, type] of ADDED_META_COLUMNS) {
    if (have.has(name)) continue;
    try {
      await db.execute(`ALTER TABLE verdict_meta ADD COLUMN ${name} ${type}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!/duplicate column name/i.test(message)) throw e;
    }
  }
}

/** Creates the case tables (with their added columns), the originals
 * tables, and runs the backfills, once per process. Idempotent. */
export async function ensureOriginalsTables(): Promise<void> {
  await ensureCaseTables();
  const client = await getDb();
  const cached = globalForOriginals.__judgeOriginalsReady;
  if (cached?.client === client) return cached.ready;
  const ready = client
    .batch(SCHEMA, "write")
    .then(() => addMetaColumns(client))
    .then(() => client.batch(backfillStatements(new Date().toISOString()), "write"))
    .then(
      () => undefined,
      (e: unknown) => {
        globalForOriginals.__judgeOriginalsReady = undefined;
        throw e;
      },
    );
  globalForOriginals.__judgeOriginalsReady = { client, ready };
  return ready;
}

export async function originalsDb(): Promise<Client> {
  await ensureOriginalsTables();
  return getDb();
}

// --- Reads ------------------------------------------------------------------------

export type VerdictMeta = {
  verdictId: string;
  kind: "free" | "premium" | "case" | "legacy";
  ownerUserId: string | null;
  ownerTokenHash: string | null;
  caseId: string | null;
  namesVisible: boolean;
  displaySealed: string | null;
  /** The writer has saved the share-page names at least once. */
  namesConfirmed: boolean;
  removedAt: string | null;
  removalReason: RemovalReason | null;
  createdAt: string;
};

const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

function mapMeta(r: Row): VerdictMeta {
  return {
    verdictId: String(r.verdict_id),
    kind: String(r.kind) as VerdictMeta["kind"],
    ownerUserId: strOrNull(r.owner_user_id),
    ownerTokenHash: strOrNull(r.owner_token_hash),
    caseId: strOrNull(r.case_id),
    namesVisible: Number(r.names_visible ?? 1) === 1,
    displaySealed: strOrNull(r.display_sealed),
    namesConfirmed: r.names_confirmed_at != null,
    removedAt: strOrNull(r.removed_at),
    removalReason: strOrNull(r.removal_reason) as RemovalReason | null,
    createdAt: String(r.created_at),
  };
}

export async function getVerdictMeta(id: string): Promise<VerdictMeta | null> {
  const db = await originalsDb();
  const rs = await db.execute({ sql: "SELECT * FROM verdict_meta WHERE verdict_id = ?", args: [id] });
  return rs.rows[0] ? mapMeta(rs.rows[0]) : null;
}

export async function getOriginal(subject: string): Promise<{ sealed: string | null; removedAt: string | null } | null> {
  const db = await originalsDb();
  const rs = await db.execute({ sql: "SELECT sealed, removed_at FROM originals WHERE subject = ?", args: [subject] });
  const row = rs.rows[0];
  return row ? { sealed: strOrNull(row.sealed), removedAt: strOrNull(row.removed_at) } : null;
}

export const subjects = {
  verdict: (verdictId: string) => `verdict:${verdictId}`,
  side: (caseId: string, party: "a" | "b") => `case:${caseId}:side:${party}`,
  appeal: (caseId: string, party: "a" | "b") => `case:${caseId}:appeal:${party}`,
};

export type OwnerVerdictRow = {
  id: string;
  kind: "free" | "premium";
  createdAt: string;
  removedAt: string | null;
  result: VerdictResult | null;
  sealed: string | null;
};

/** One-sided verdicts owned by a user, newest first, each with its current
 * ruling (the latest appeal's verdict, if any). The verdicts appeals
 * produced are not listed on their own. */
export async function listOwnerVerdicts(userId: string, limit: number, before: string | null): Promise<OwnerVerdictRow[]> {
  const db = await originalsDb();
  const rs = await db.execute({
    sql: `SELECT m.verdict_id, m.kind, m.created_at, m.removed_at, o.sealed,
            COALESCE((SELECT av.result FROM verdict_appeals a JOIN verdicts av ON av.id = a.id
                        LEFT JOIN verdict_meta am ON am.verdict_id = a.id
                      WHERE a.verdict_id = m.verdict_id AND am.removed_at IS NULL
                      ORDER BY a.created_at DESC, a.id DESC LIMIT 1), v.result) AS result
          FROM verdict_meta m
          JOIN verdicts v ON v.id = m.verdict_id
          LEFT JOIN originals o ON o.subject = 'verdict:' || m.verdict_id
          WHERE m.owner_user_id = ? AND m.kind IN ('free','premium') AND (? IS NULL OR m.created_at < ?)
            AND NOT EXISTS (SELECT 1 FROM verdict_appeals a WHERE a.id = m.verdict_id)
          ORDER BY m.created_at DESC, m.verdict_id DESC
          LIMIT ?`,
    args: [userId, before, before, limit],
  });
  return rs.rows.map((r) => {
    let result: VerdictResult | null = null;
    try {
      const parsed = VerdictResult.safeParse(JSON.parse(String(r.result)));
      result = parsed.success ? parsed.data : null;
    } catch {
      result = null;
    }
    return {
      id: String(r.verdict_id),
      kind: String(r.kind) === "premium" ? "premium" : "free",
      createdAt: String(r.created_at),
      removedAt: strOrNull(r.removed_at),
      result,
      sealed: strOrNull(r.sealed),
    };
  });
}
