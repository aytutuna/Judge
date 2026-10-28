import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/** A cases table from before the other interface languages, whose lang
 * column allowed only en and tr, and which got its later columns by ALTER. */

const dir = mkdtempSync(path.join(tmpdir(), "verdict-cases-lang-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { getDb } = await import("../lib/db");
const { ensureCaseTables, getCase } = await import("../lib/cases/db");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const OLD_CASES = `CREATE TABLE IF NOT EXISTS cases (
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
    attempts            INTEGER NOT NULL DEFAULT 0,
    last_error          TEXT CHECK (last_error IN ('quota','unavailable')),
    owner_notified      INTEGER NOT NULL DEFAULT 0,
    expires_at          TEXT NOT NULL,
    judged_at           TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  )`;

const insert = (id: string, lang: string) =>
  `INSERT INTO cases (id, owner_id, status, framework, lang, invite_nonce, invite_hash, expires_at, created_at, updated_at)
   VALUES ('${id}', 'o1', 'awaiting_respondent', 'default', '${lang}', 'n-${id}', 'h-${id}',
           '2030-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`;

describe("cases.lang on an old table", () => {
  it("drops the en/tr CHECK and keeps every row and index", async () => {
    const db = await getDb();
    await db.execute(OLD_CASES);
    await db.execute("CREATE INDEX IF NOT EXISTS cases_owner ON cases (owner_id, created_at)");
    await db.execute(insert("old-tr", "tr"));
    await db.execute(insert("old-en", "en"));
    await expect(db.execute(insert("old-de", "de"))).rejects.toThrow(/CHECK/i);
    const before = (await db.execute("SELECT * FROM cases ORDER BY id")).rows;

    await ensureCaseTables();

    const sql = String((await db.execute("SELECT sql FROM sqlite_master WHERE name = 'cases'")).rows[0].sql);
    expect(sql).not.toMatch(/lang\s+IN/i);
    expect(sql).toMatch(/^CREATE TABLE "?cases"?/);
    const cols = (await db.execute("PRAGMA table_info(cases)")).rows.map((r) => String(r.name));
    for (const c of ["respondent_claim_nonce", "tier", "removed_at"]) expect(cols).toContain(c);
    const after = (await db.execute("SELECT * FROM cases ORDER BY id")).rows;
    expect(after.map((r) => ({ ...r }))).toEqual(
      before.map((r) => ({ ...r, respondent_claim_nonce: null, names_visible: 1, display_a_sealed: null, display_b_sealed: null, display_key_id: null, removed_at: null, removed_a_at: null, removed_b_at: null, tier: "premium" })),
    );
    expect((await getCase("old-tr"))?.lang).toBe("tr");

    const indexes = (await db.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'cases'")).rows.map((r) => String(r.name));
    for (const i of ["cases_owner", "cases_owner_idem", "cases_status_expires", "cases_respondent"]) expect(indexes).toContain(i);
    await expect(db.execute(insert("dup", "en").replace("'h-dup'", "'h-old-tr'"))).rejects.toThrow(/UNIQUE/i);

    await db.execute(insert("new-de", "de"));
    expect((await getCase("new-de"))?.lang).toBe("de");
  });

  it("leaves a migrated table alone on the next start", async () => {
    const db = await getDb();
    const sql = String((await db.execute("SELECT sql FROM sqlite_master WHERE name = 'cases'")).rows[0].sql);
    (globalThis as unknown as { __verdictCasesReady?: unknown }).__verdictCasesReady = undefined;
    await ensureCaseTables();
    expect(String((await db.execute("SELECT sql FROM sqlite_master WHERE name = 'cases'")).rows[0].sql)).toBe(sql);
    expect((await db.execute("SELECT count(*) AS n FROM cases")).rows[0].n).toBe(3);
  });
});
