import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/** The tables as they were when a case had two sides: party limited to a and
 * b, no sides column, one invite link in the cases row. The migration must
 * keep every row, index and old link, and be safe to run again. */

const dir = mkdtempSync(path.join(tmpdir(), "verdict-cases-sides-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { getDb } = await import("../lib/db");
const { ensureCaseTables, getCase, getCaseByAnyInviteHash, getInvites } = await import("../lib/cases/db");
const { ensureOriginalsTables } = await import("../lib/originals/db");
const { rebuildTable, PARTY_CHECK, PARTY_CHECK_WIDE } = await import("../lib/db-rebuild");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const OLD_SCHEMA = [
  `CREATE TABLE cases (
    id                  TEXT PRIMARY KEY,
    owner_id            TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN
                          ('awaiting_respondent','judging','judged','failed','expired')),
    mode                TEXT CHECK (mode IN ('two_sided','one_sided')),
    framework           TEXT NOT NULL,
    lang                TEXT NOT NULL,
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
    updated_at          TEXT NOT NULL,
    names_visible       INTEGER NOT NULL DEFAULT 1,
    display_a_sealed    TEXT,
    display_b_sealed    TEXT,
    display_key_id      TEXT,
    removed_at          TEXT,
    removed_a_at        TEXT,
    removed_b_at        TEXT,
    tier                TEXT NOT NULL DEFAULT 'premium' CHECK (tier IN ('free','premium'))
  )`,
  "CREATE INDEX cases_owner ON cases (owner_id, created_at)",
  "CREATE INDEX cases_respondent ON cases (respondent_user_id) WHERE respondent_user_id IS NOT NULL",
  `CREATE TABLE case_sides (
    case_id       TEXT NOT NULL,
    party         TEXT NOT NULL CHECK (party IN ('a','b')),
    text          TEXT NOT NULL,
    submitted_at  TEXT NOT NULL,
    PRIMARY KEY (case_id, party)
  )`,
  `CREATE TABLE case_appeals (
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
  "CREATE INDEX case_appeals_status ON case_appeals (status, updated_at)",
  `CREATE TABLE case_evidence (
    id          TEXT PRIMARY KEY,
    case_id     TEXT NOT NULL,
    party       TEXT NOT NULL CHECK (party IN ('a','b')),
    appeal_id   TEXT,
    seq         INTEGER NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('chat','document','photo','other')),
    transcript  TEXT NOT NULL,
    created_at  TEXT NOT NULL
  )`,
  "CREATE INDEX case_evidence_case ON case_evidence (case_id, party, appeal_id, seq)",
  `CREATE TABLE verdict_meta (
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
  "CREATE INDEX verdict_meta_case ON verdict_meta (case_id) WHERE case_id IS NOT NULL",
  `CREATE TABLE originals (
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
  "CREATE INDEX originals_case ON originals (case_id, party) WHERE case_id IS NOT NULL",
];

const T = "2026-01-01T00:00:00.000Z";
const SAMPLE = [
  `INSERT INTO cases (id, owner_id, status, mode, framework, lang, invite_nonce, invite_hash, respondent_user_id,
                     respondent_claim_nonce, expires_at, created_at, updated_at)
   VALUES ('case-1', 'owner-1', 'judged', 'two_sided', 'default', 'en', 'n1', 'hash-old-link', 'bob', 'claim-1', '2030-01-01T00:00:00.000Z', '${T}', '${T}')`,
  `INSERT INTO cases (id, owner_id, status, framework, lang, invite_nonce, invite_hash, expires_at, created_at, updated_at)
   VALUES ('case-2', 'owner-2', 'awaiting_respondent', 'default', 'tr', 'n2', 'hash-waiting', '2030-01-01T00:00:00.000Z', '${T}', '${T}')`,
  `INSERT INTO case_sides VALUES ('case-1', 'a', 'my account', '${T}'), ('case-1', 'b', 'their account', '${T}'), ('case-2', 'a', 'only mine', '${T}')`,
  `INSERT INTO case_appeals VALUES ('ap-1', 'case-1', 'b', 'bob', 'new context', 'judged', NULL, 'res-1', 'tok-1', 1, 2, 'upheld', '${T}', '${T}')`,
  `INSERT INTO case_evidence VALUES ('ev-1', 'case-1', 'a', NULL, 1, 'chat', 'ME: hi', '${T}'), ('ev-2', 'case-1', 'b', 'ap-1', 1, 'photo', 'a receipt', '${T}')`,
  `INSERT INTO verdict_meta (verdict_id, kind, case_id, removed_at, removal_reason, created_at, updated_at)
   VALUES ('v-1', 'case', 'case-1', '${T}', 'party_b', '${T}', '${T}'), ('v-2', 'free', NULL, NULL, NULL, '${T}', '${T}')`,
  `INSERT INTO originals (subject, kind, case_id, party, sealed, created_at, updated_at)
   VALUES ('case:case-1:side:a', 'side', 'case-1', 'a', 's1', '${T}', '${T}'), ('case:case-1:side:b', 'side', 'case-1', 'b', 's2', '${T}', '${T}'),
          ('verdict:v-2', 'verdict', NULL, NULL, 's3', '${T}', '${T}')`,
];

const TABLES = ["cases", "case_sides", "case_appeals", "case_evidence", "verdict_meta", "originals"];

async function rows(table: string) {
  const db = await getDb();
  return (await db.execute(`SELECT * FROM ${table} ORDER BY 1, 2`)).rows.map((r) => ({ ...r }));
}

async function indexes(table: string) {
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? ORDER BY name", args: [table] });
  return rs.rows.map((r) => ({ name: String(r.name), sql: r.sql == null ? null : String(r.sql) }));
}

async function tableSql(table: string) {
  const db = await getDb();
  return String((await db.execute({ sql: "SELECT sql FROM sqlite_master WHERE name = ?", args: [table] })).rows[0].sql);
}

async function reset() {
  (globalThis as unknown as Record<string, unknown>).__verdictCasesReady = undefined;
  (globalThis as unknown as Record<string, unknown>).__judgeOriginalsReady = undefined;
  await ensureOriginalsTables();
}

describe("party checks widened on a database from the two-sided era", () => {
  let before: Record<string, Record<string, unknown>[]> = {};
  let indexesBefore: Record<string, { name: string; sql: string | null }[]> = {};

  it("keeps every row and index and the old invite link", async () => {
    const db = await getDb();
    await db.batch(OLD_SCHEMA, "write");
    await db.batch(SAMPLE, "write");
    await expect(db.execute("INSERT INTO case_sides VALUES ('case-1', 'c', 'x', 'y')")).rejects.toThrow(/CHECK/i);
    for (const t of TABLES) {
      before[t] = await rows(t);
      indexesBefore[t] = await indexes(t);
    }

    await reset();
    await ensureCaseTables();

    for (const t of TABLES.filter((x) => x !== "cases")) expect(await rows(t)).toEqual(before[t]);
    const cases = await rows("cases");
    expect(cases.map((r) => r.id)).toEqual(["case-1", "case-2"]);
    for (const [i, c] of cases.entries()) {
      for (const [k, v] of Object.entries(before.cases[i])) expect(c[k], `${c.id}.${k}`).toEqual(v);
      expect(c.sides).toBe(2);
    }
    for (const t of TABLES) {
      const after = await indexes(t);
      for (const i of indexesBefore[t]) expect(after, `${t}.${i.name}`).toContainEqual(i);
    }
    for (const t of ["case_sides", "case_appeals", "case_evidence", "originals"]) {
      expect(await tableSql(t)).toMatch(/party IN \('a','b','c','d'\)/);
      expect((await db.execute(`PRAGMA foreign_key_list(${t})`)).rows).toHaveLength(0);
    }
    expect((await tableSql("verdict_meta"))).toMatch(/'party_c','party_d'/);
    // case_appeals keeps its one-appeal-per-side rule.
    await expect(
      db.execute(`INSERT INTO case_appeals VALUES ('ap-2', 'case-1', 'b', NULL, 't', 'judging', NULL, 'r', 't', 1, NULL, NULL, '${T}', '${T}')`),
    ).rejects.toThrow(/UNIQUE/i);

    const found = await getCaseByAnyInviteHash("hash-old-link");
    expect(found?.party).toBe("b");
    expect(found?.row.id).toBe("case-1");
    expect(found?.row.respondentUserId).toBe("bob");
    expect(await getCaseByAnyInviteHash("nothing")).toBeNull();
    expect((await getCase("case-2"))?.sides).toBe(2);
    expect(await getInvites("case-1")).toEqual([]);
  });

  it("accepts sides C and D now, and still refuses anything else", async () => {
    const db = await getDb();
    await db.execute(`INSERT INTO case_sides VALUES ('case-2', 'c', 'third', '${T}'), ('case-2', 'd', 'fourth', '${T}')`);
    await db.execute(`INSERT INTO originals (subject, kind, case_id, party, created_at, updated_at) VALUES ('case:case-2:side:c', 'side', 'case-2', 'c', '${T}', '${T}')`);
    await db.execute(`INSERT INTO case_evidence VALUES ('ev-3', 'case-2', 'd', NULL, 1, 'chat', 'x', '${T}')`);
    await expect(db.execute(`INSERT INTO case_sides VALUES ('case-2', 'e', 'x', '${T}')`)).rejects.toThrow(/CHECK/i);
    await db.execute(`UPDATE verdict_meta SET removal_reason = 'party_d' WHERE verdict_id = 'v-1'`);
    await db.execute(`UPDATE verdict_meta SET removal_reason = 'party_b' WHERE verdict_id = 'v-1'`);
    await db.execute("DELETE FROM case_sides WHERE party IN ('c', 'd')");
    await db.execute("DELETE FROM originals WHERE party = 'c'");
    await db.execute("DELETE FROM case_evidence WHERE id = 'ev-3'");
  });

  it("changes nothing when it runs again", async () => {
    const db = await getDb();
    const sqls = Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await tableSql(t)] as const)));
    const data = Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await rows(t)] as const)));
    await reset();
    await reset();
    for (const t of TABLES) {
      expect(await tableSql(t)).toBe(sqls[t]);
      expect(await rows(t)).toEqual(data[t]);
    }
    expect((await db.execute("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE '%_rebuild'")).rows[0].n).toBe(0);
  });

  it("recovers from an interrupted rebuild: the old table stays, a leftover copy is dropped", async () => {
    const db = await getDb();
    await db.execute("CREATE TABLE case_sides_old_check (case_id TEXT NOT NULL, party TEXT NOT NULL CHECK (party IN ('a','b')), text TEXT NOT NULL, submitted_at TEXT NOT NULL, PRIMARY KEY (case_id, party))");
    await db.execute(`INSERT INTO case_sides_old_check VALUES ('case-1', 'a', 'kept', '${T}')`);
    await db.execute("CREATE TABLE case_sides_old_check_rebuild (junk TEXT)");
    expect(await rebuildTable(db, "case_sides_old_check", PARTY_CHECK, PARTY_CHECK_WIDE)).toBe(true);
    expect(await rows("case_sides_old_check")).toEqual([{ case_id: "case-1", party: "a", text: "kept", submitted_at: T }]);
    expect(await rebuildTable(db, "case_sides_old_check", PARTY_CHECK, PARTY_CHECK_WIDE)).toBe(false);
    await db.execute("DROP TABLE case_sides_old_check");
  });

  it("a failed rebuild leaves the old table untouched", async () => {
    const db = await getDb();
    await db.execute("CREATE TABLE halfway (id TEXT PRIMARY KEY, party TEXT CHECK (party IN ('a','b')), n INTEGER NOT NULL)");
    await db.execute("INSERT INTO halfway VALUES ('x', 'a', 1)");
    // A replacement that no row can satisfy: the copy fails inside the batch.
    await expect(rebuildTable(db, "halfway", PARTY_CHECK, "party IN ('z') AND n > 5")).rejects.toThrow();
    expect(await rows("halfway")).toEqual([{ id: "x", party: "a", n: 1 }]);
    expect(await tableSql("halfway")).toMatch(/party IN \('a','b'\)/);
    await db.execute("DROP TABLE IF EXISTS halfway_rebuild");
    await db.execute("DROP TABLE halfway");
  });
});
