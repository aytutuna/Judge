/**
 * Two-sided cases: tables and reads. Writes live in service.ts, judging.ts
 * and sweep.ts and always go through the entitlements module's serialized,
 * busy-retried batch writer (entitlementWriteBatch), so case writes and
 * credit writes never race each other. No interactive transactions.
 *
 * The tables here hold anonymized text only. Each party's original (text as
 * written, raw transcripts, name map) and display name are kept encrypted:
 * originals in the `originals` table (lib/originals), display names in the
 * sealed `display_*` columns. case_people keeps keyed, case-salted
 * fingerprints of names (lib/evidence caseNameKeys), never names.
 * Rows are never deleted: removal blanks personal data and closes the links.
 *
 * Timestamps are ISO-8601 UTC strings, so string order is time order.
 */

import type { Client, Row } from "@libsql/client";
import type { CaseMode, CaseStatus, PartyLetter, AppealStatus } from "@/lib/case-types";
import { getDb } from "@/lib/db";
import { ensureEntitlementTables } from "@/lib/entitlements";
import type { KnownPerson } from "@/lib/evidence";
import type { Lang } from "@/lib/i18n";
import { VerdictResult, type AppealOutcome, type EvidenceKind, type FrameworkChoice, type Tier } from "@/lib/types";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS cases (
    id                  TEXT PRIMARY KEY,
    owner_id            TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN
                          ('awaiting_respondent','judging','judged','failed','expired')),
    mode                TEXT CHECK (mode IN ('two_sided','one_sided')),
    framework           TEXT NOT NULL,
    lang                TEXT NOT NULL CHECK (lang IN ('en','tr')),
    invite_nonce        TEXT NOT NULL,
    invite_hash         TEXT NOT NULL UNIQUE,
    idempotency_key     TEXT,
    reservation_id      TEXT,
    judging_token       TEXT,
    judging_started_at  TEXT,
    respondent_idem     TEXT,
    respondent_user_id  TEXT,
    respondent_claim_nonce TEXT,
    attempts            INTEGER NOT NULL DEFAULT 0,
    last_error          TEXT CHECK (last_error IN ('quota','unavailable')),
    owner_notified      INTEGER NOT NULL DEFAULT 0,
    expires_at          TEXT NOT NULL,
    judged_at           TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS cases_owner_idem ON cases (owner_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL`,
  "CREATE INDEX IF NOT EXISTS cases_owner ON cases (owner_id, created_at)",
  "CREATE INDEX IF NOT EXISTS cases_status_expires ON cases (status, expires_at)",
  "CREATE INDEX IF NOT EXISTS cases_status_started ON cases (status, judging_started_at)",
  `CREATE INDEX IF NOT EXISTS cases_respondent ON cases (respondent_user_id)
    WHERE respondent_user_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS case_sides (
    case_id       TEXT NOT NULL,
    party         TEXT NOT NULL CHECK (party IN ('a','b')),
    text          TEXT NOT NULL,
    submitted_at  TEXT NOT NULL,
    PRIMARY KEY (case_id, party)
  )`,
  `CREATE TABLE IF NOT EXISTS case_appeals (
    id              TEXT PRIMARY KEY,
    case_id         TEXT NOT NULL,
    party           TEXT NOT NULL CHECK (party IN ('a','b')),
    user_id         TEXT,
    text            TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('judging','judged','failed')),
    error           TEXT CHECK (error IN ('quota','unavailable','refused')),
    reservation_id  TEXT NOT NULL,
    attempt_token   TEXT NOT NULL,
    base_seq        INTEGER NOT NULL,
    result_seq      INTEGER,
    outcome         TEXT CHECK (outcome IN ('upheld','overturned','changed')),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (case_id, party)
  )`,
  "CREATE INDEX IF NOT EXISTS case_appeals_status ON case_appeals (status, updated_at)",
  `CREATE TABLE IF NOT EXISTS case_evidence (
    id          TEXT PRIMARY KEY,
    case_id     TEXT NOT NULL,
    party       TEXT NOT NULL CHECK (party IN ('a','b')),
    appeal_id   TEXT,
    seq         INTEGER NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('chat','document','photo','other')),
    transcript  TEXT NOT NULL,
    created_at  TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS case_evidence_case ON case_evidence (case_id, party, appeal_id, seq)",
  `CREATE TABLE IF NOT EXISTS case_people (
    case_id   TEXT NOT NULL,
    name_key  TEXT NOT NULL,
    label     TEXT NOT NULL,
    PRIMARY KEY (case_id, name_key)
  )`,
  `CREATE TABLE IF NOT EXISTS case_verdicts (
    case_id     TEXT NOT NULL,
    seq         INTEGER NOT NULL,
    verdict_id  TEXT NOT NULL UNIQUE,
    appeal_id   TEXT,
    mode        TEXT NOT NULL CHECK (mode IN ('two_sided','one_sided')),
    created_at  TEXT NOT NULL,
    PRIMARY KEY (case_id, seq)
  )`,
];

const globalForCases = globalThis as unknown as {
  __verdictCasesReady?: { client: Client; ready: Promise<void> };
};

/** Creates the case tables once per process (per database client). The
 * entitlement tables come first: case writes use premium_usage.hold_until. */
export async function ensureCaseTables(): Promise<void> {
  await ensureEntitlementTables();
  const client = await getDb();
  const cached = globalForCases.__verdictCasesReady;
  if (cached?.client === client) return cached.ready;
  const ready = client
    .batch(SCHEMA, "write")
    .then(() => addClaimColumn(client))
    .then(() => addCaseColumns(client))
    .then(
      () => undefined,
      (e: unknown) => {
        globalForCases.__verdictCasesReady = undefined;
        throw e;
      },
    );
  globalForCases.__verdictCasesReady = { client, ready };
  return ready;
}

/** Adds cases.respondent_claim_nonce to tables created before it existed.
 * A concurrent process adding it first is fine. */
async function addClaimColumn(db: Client): Promise<void> {
  const info = await db.execute("PRAGMA table_info(cases)");
  if (info.rows.some((r) => String(r.name) === "respondent_claim_nonce")) return;
  try {
    await db.execute("ALTER TABLE cases ADD COLUMN respondent_claim_nonce TEXT");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/duplicate column name/i.test(message)) throw e;
  }
}

/** Columns added after the first release of the case tables (stored
 * originals, display names, removal, free cases). Every case created
 * before tier existed held a premium unit, hence the default. */
const ADDED_COLUMNS: [string, string][] = [
  ["names_visible", "INTEGER NOT NULL DEFAULT 1"],
  ["display_a_sealed", "TEXT"],
  ["display_b_sealed", "TEXT"],
  ["display_key_id", "TEXT"],
  ["removed_at", "TEXT"],
  ["removed_a_at", "TEXT"],
  ["removed_b_at", "TEXT"],
  ["tier", "TEXT NOT NULL DEFAULT 'premium' CHECK (tier IN ('free','premium'))"],
];

async function addCaseColumns(db: Client): Promise<void> {
  const info = await db.execute("PRAGMA table_info(cases)");
  const have = new Set(info.rows.map((r) => String(r.name)));
  for (const [name, type] of ADDED_COLUMNS) {
    if (have.has(name)) continue;
    try {
      await db.execute(`ALTER TABLE cases ADD COLUMN ${name} ${type}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!/duplicate column name/i.test(message)) throw e;
    }
  }
}

/** The migrated client, for reads. */
export async function caseDb(): Promise<Client> {
  await ensureCaseTables();
  return getDb();
}

// --- Row shapes -----------------------------------------------------------------

export type CaseRow = {
  id: string;
  ownerId: string;
  /** As stored; see effectiveStatus for what readers report. */
  status: CaseStatus;
  mode: CaseMode | null;
  /** Which judges run the case's first verdict, and whether a unit is held. */
  tier: Tier;
  framework: FrameworkChoice;
  lang: Lang;
  inviteNonce: string;
  inviteHash: string;
  idempotencyKey: string | null;
  reservationId: string | null;
  judgingToken: string | null;
  judgingStartedAt: string | null;
  respondentIdem: string | null;
  respondentUserId: string | null;
  /** Set when side B is submitted: the respondent's claim secret is derived
   * from it (see invite.ts respondentClaim); the secret itself is never stored. */
  respondentClaimNonce: string | null;
  attempts: number;
  lastError: "quota" | "unavailable" | null;
  ownerNotified: boolean;
  expiresAt: string;
  judgedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** The owner's switch: display names on the case's share pages. */
  namesVisible: boolean;
  /** Sealed display names ({"v":1,"name":...}); null = the label. */
  displayASealed: string | null;
  displayBSealed: string | null;
  /** First removal of any side: every link of the case is closed from then on. */
  removedAt: string | null;
  removedAAt: string | null;
  removedBAt: string | null;
};

export type SideRow = { party: PartyLetter; text: string; submittedAt: string };

export type EvidenceRow = {
  id: string;
  party: PartyLetter;
  appealId: string | null;
  seq: number;
  kind: EvidenceKind;
  transcript: string;
};

export type AppealRow = {
  id: string;
  party: PartyLetter;
  userId: string | null;
  text: string;
  status: AppealStatus;
  error: "quota" | "unavailable" | "refused" | null;
  reservationId: string;
  attemptToken: string;
  baseSeq: number;
  resultSeq: number | null;
  outcome: AppealOutcome | null;
  createdAt: string;
  updatedAt: string;
};

export type CaseVerdictRow = {
  seq: number;
  verdictId: string;
  appealId: string | null;
  mode: CaseMode;
  createdAt: string;
  /** Null when the stored verdict no longer parses. */
  result: VerdictResult | null;
};

export type CaseBundle = {
  row: CaseRow;
  sides: SideRow[];
  evidence: EvidenceRow[];
  appeals: AppealRow[];
  verdicts: CaseVerdictRow[];
  people: KnownPerson[];
};

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

function parseJson<T>(raw: unknown, fallback: T): T {
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

export function mapCase(r: Row): CaseRow {
  return {
    id: str(r.id),
    ownerId: str(r.owner_id),
    status: str(r.status) as CaseStatus,
    mode: strOrNull(r.mode) as CaseMode | null,
    tier: str(r.tier) === "free" ? "free" : "premium",
    framework: parseJson<FrameworkChoice>(r.framework, { preset: "balanced" }),
    lang: str(r.lang) === "tr" ? "tr" : "en",
    inviteNonce: str(r.invite_nonce),
    inviteHash: str(r.invite_hash),
    idempotencyKey: strOrNull(r.idempotency_key),
    reservationId: strOrNull(r.reservation_id),
    judgingToken: strOrNull(r.judging_token),
    judgingStartedAt: strOrNull(r.judging_started_at),
    respondentIdem: strOrNull(r.respondent_idem),
    respondentUserId: strOrNull(r.respondent_user_id),
    respondentClaimNonce: strOrNull(r.respondent_claim_nonce),
    attempts: Number(r.attempts ?? 0),
    lastError: strOrNull(r.last_error) as CaseRow["lastError"],
    ownerNotified: Number(r.owner_notified ?? 0) === 1,
    expiresAt: str(r.expires_at),
    judgedAt: strOrNull(r.judged_at),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    namesVisible: r.names_visible == null ? true : Number(r.names_visible) === 1,
    displayASealed: strOrNull(r.display_a_sealed),
    displayBSealed: strOrNull(r.display_b_sealed),
    removedAt: strOrNull(r.removed_at),
    removedAAt: strOrNull(r.removed_a_at),
    removedBAt: strOrNull(r.removed_b_at),
  };
}

function mapAppeal(r: Row): AppealRow {
  return {
    id: str(r.id),
    party: str(r.party) as PartyLetter,
    userId: strOrNull(r.user_id),
    text: str(r.text),
    status: str(r.status) as AppealStatus,
    error: strOrNull(r.error) as AppealRow["error"],
    reservationId: str(r.reservation_id),
    attemptToken: str(r.attempt_token),
    baseSeq: Number(r.base_seq),
    resultSeq: r.result_seq == null ? null : Number(r.result_seq),
    outcome: strOrNull(r.outcome) as AppealOutcome | null,
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

// --- Reads ----------------------------------------------------------------------

export async function getCase(id: string): Promise<CaseRow | null> {
  const db = await caseDb();
  const rs = await db.execute({ sql: "SELECT * FROM cases WHERE id = ?", args: [id] });
  return rs.rows[0] ? mapCase(rs.rows[0]) : null;
}

export async function getCaseByInviteHash(hash: string): Promise<CaseRow | null> {
  const db = await caseDb();
  const rs = await db.execute({ sql: "SELECT * FROM cases WHERE invite_hash = ?", args: [hash] });
  return rs.rows[0] ? mapCase(rs.rows[0]) : null;
}

export async function getCaseByOwnerKey(ownerId: string, key: string): Promise<CaseRow | null> {
  const db = await caseDb();
  const rs = await db.execute({
    sql: "SELECT * FROM cases WHERE owner_id = ? AND idempotency_key = ?",
    args: [ownerId, key],
  });
  return rs.rows[0] ? mapCase(rs.rows[0]) : null;
}

export async function getAppeal(caseId: string, party: PartyLetter): Promise<AppealRow | null> {
  const db = await caseDb();
  const rs = await db.execute({
    sql: "SELECT * FROM case_appeals WHERE case_id = ? AND party = ?",
    args: [caseId, party],
  });
  return rs.rows[0] ? mapAppeal(rs.rows[0]) : null;
}

/** Everything about one case, in parallel reads. */
export async function loadCaseBundle(row: CaseRow): Promise<CaseBundle> {
  const db = await caseDb();
  const id = row.id;
  const [sides, evidence, appeals, verdicts, people] = await Promise.all([
    db.execute({ sql: "SELECT party, text, submitted_at FROM case_sides WHERE case_id = ? ORDER BY party", args: [id] }),
    db.execute({
      sql: `SELECT id, party, appeal_id, seq, kind, transcript FROM case_evidence
            WHERE case_id = ? ORDER BY party, appeal_id, seq`,
      args: [id],
    }),
    db.execute({ sql: "SELECT * FROM case_appeals WHERE case_id = ? ORDER BY created_at, id", args: [id] }),
    db.execute({
      sql: `SELECT cv.seq, cv.verdict_id, cv.appeal_id, cv.mode, cv.created_at, v.result
            FROM case_verdicts cv LEFT JOIN verdicts v ON v.id = cv.verdict_id
            WHERE cv.case_id = ? ORDER BY cv.seq`,
      args: [id],
    }),
    db.execute({ sql: "SELECT name_key, label FROM case_people WHERE case_id = ?", args: [id] }),
  ]);
  return {
    row,
    sides: sides.rows.map((r) => ({
      party: str(r.party) as PartyLetter,
      text: str(r.text),
      submittedAt: str(r.submitted_at),
    })),
    evidence: evidence.rows.map((r) => ({
      id: str(r.id),
      party: str(r.party) as PartyLetter,
      appealId: strOrNull(r.appeal_id),
      seq: Number(r.seq),
      kind: str(r.kind) as EvidenceKind,
      transcript: str(r.transcript),
    })),
    appeals: appeals.rows.map(mapAppeal),
    verdicts: verdicts.rows.map((r) => {
      const parsed = r.result == null ? null : VerdictResult.safeParse(parseJson<unknown>(r.result, null));
      return {
        seq: Number(r.seq),
        verdictId: str(r.verdict_id),
        appealId: strOrNull(r.appeal_id),
        mode: str(r.mode) as CaseMode,
        createdAt: str(r.created_at),
        result: parsed?.success ? parsed.data : null,
      };
    }),
    people: people.rows.map((r) => ({ key: str(r.name_key), label: str(r.label) })),
  };
}

export type CaseListRow = CaseRow & {
  respondentAnswered: boolean;
  latestResult: VerdictResult | null;
  /** The start of the owner's anonymized side (list titles before a verdict). */
  sideAStart: string | null;
};

/** The owner's cases, newest first, with the latest verdict of each. */
export async function listOwnerCases(ownerId: string, limit: number, before: string | null): Promise<CaseListRow[]> {
  const db = await caseDb();
  const rs = await db.execute({
    sql: `SELECT c.*,
            EXISTS (SELECT 1 FROM case_sides s WHERE s.case_id = c.id AND s.party = 'b') AS answered,
            (SELECT v.result FROM case_verdicts cv JOIN verdicts v ON v.id = cv.verdict_id
             WHERE cv.case_id = c.id ORDER BY cv.seq DESC LIMIT 1) AS latest,
            (SELECT substr(s.text, 1, 200) FROM case_sides s WHERE s.case_id = c.id AND s.party = 'a') AS side_a_start
          FROM cases c
          WHERE c.owner_id = ? AND (? IS NULL OR c.created_at < ?)
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT ?`,
    args: [ownerId, before, before, limit],
  });
  return rs.rows.map((r) => {
    const parsed = r.latest == null ? null : VerdictResult.safeParse(parseJson<unknown>(r.latest, null));
    return {
      ...mapCase(r),
      respondentAnswered: Number(r.answered) === 1,
      latestResult: parsed?.success ? parsed.data : null,
      sideAStart: strOrNull(r.side_a_start),
    };
  });
}
