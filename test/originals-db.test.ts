import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Migration and backfill on a database that already has verdicts, premium
 * usage and case verdicts from before stored originals existed (like the
 * live one), plus removal of rows that predate the feature. */

const dir = mkdtempSync(path.join(tmpdir(), "verdict-originals-db-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { getDb } = await import("../lib/db");
const { ensureCaseTables } = await import("../lib/cases/db");
const odb = await import("../lib/originals/db");
const { getPublicVerdict } = await import("../lib/originals/display");
const { verdictRemoved } = await import("../lib/originals/removed");
const removal = await import("../lib/originals/removal");

const RESULT = JSON.stringify({
  verdict: "side_b",
  dispute_type: "values",
  headline: "Party B is right",
  crux: "c",
  split_points: null,
  conditional: null,
  argument_map: { side_a: [{ claim: "a", kind: "fact" }], side_b: [{ claim: "b", kind: "fact" }], bedrock_a: "a", bedrock_b: "b" },
  facts_relied_on: [],
  losing_side_best_point: "p",
  confidence: 3,
  runs: ["side_b"],
  demo: false,
});

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

async function n(sql: string, args: string[] = []): Promise<number> {
  const db = await getDb();
  return Number((await db.execute({ sql, args })).rows[0].n);
}

beforeAll(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // The state before this feature: tables without the new columns/tables.
  await ensureCaseTables();
  const db = await getDb();
  const now = "2026-10-01T10:00:00.000Z";
  for (const id of ["legacyFree1", "legacyPrem1", "legacyCase1"]) {
    await db.execute({ sql: "INSERT INTO verdicts (id, input, framework, result) VALUES (?, 'Party A says x', '{}', ?)", args: [id, RESULT] });
  }
  await db.execute({
    sql: `INSERT INTO premium_usage (id, user_id, funded_by, status, verdict_id, created_at, updated_at)
          VALUES ('pu1', 'user-p', 'credits', 'consumed', 'legacyPrem1', ?, ?),
                 ('pu2', 'user-c', 'credits', 'consumed', 'legacyCase1', ?, ?)`,
    args: [now, now, now, now],
  });
  await db.execute({
    sql: `INSERT INTO cases (id, owner_id, status, mode, framework, lang, invite_nonce, invite_hash, expires_at, created_at, updated_at)
          VALUES ('case-legacy1', 'user-c', 'judged', 'two_sided', '{"preset":"balanced"}', 'en', 'n', 'h-legacy', ?, ?, ?)`,
    args: [now, now, now],
  });
  await db.execute({
    sql: "INSERT INTO case_verdicts (case_id, seq, verdict_id, appeal_id, mode, created_at) VALUES ('case-legacy1', 1, 'legacyCase1', NULL, 'two_sided', ?)",
    args: [now],
  });
});

describe("ensureOriginalsTables", () => {
  it("creates the tables and backfills only what can be inferred; running it again changes nothing", async () => {
    await odb.ensureOriginalsTables();
    expect(await odb.getVerdictMeta("legacyFree1")).toBeNull();
    const prem = await odb.getVerdictMeta("legacyPrem1");
    expect(prem).toMatchObject({ kind: "premium", ownerUserId: "user-p", removedAt: null });
    expect(prem!.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    // A case verdict is never labelled premium, even with a consumed unit.
    expect(await odb.getVerdictMeta("legacyCase1")).toMatchObject({ kind: "case", caseId: "case-legacy1", ownerUserId: null });
    const before = await n("SELECT count(*) AS n FROM verdict_meta");
    (globalThis as unknown as { __judgeOriginalsReady?: unknown }).__judgeOriginalsReady = undefined;
    await odb.ensureOriginalsTables();
    expect(await n("SELECT count(*) AS n FROM verdict_meta")).toBe(before);
    const cols = (await (await getDb()).execute("PRAGMA table_info(cases)")).rows.map((r) => String(r.name));
    for (const c of ["names_visible", "display_a_sealed", "display_b_sealed", "removed_at", "removed_a_at", "removed_b_at"]) {
      expect(cols).toContain(c);
    }
  });

  it("legacy verdicts render as before: labels, not removed", async () => {
    const pub = await getPublicVerdict("legacyFree1");
    expect(pub).toMatchObject({ meta: null, display: null, removed: false });
    expect(pub!.stored.result.headline).toBe("Party B is right");
    expect(await verdictRemoved("legacyFree1")).toBe(false);
    expect(await verdictRemoved("nope")).toBe(false);
  });

  it("the owner of a legacy premium verdict sees it listed, without an original", async () => {
    const rows = await odb.listOwnerVerdicts("user-p", 10, null);
    expect(rows.map((r) => r.id)).toEqual(["legacyPrem1"]);
    expect(rows[0].sealed).toBeNull();
  });
});

describe("removal of rows that predate the feature", () => {
  it("operator removal of a legacy free verdict creates a removed 'legacy' row and keeps the verdict", async () => {
    const at = await removal.operatorRemoveVerdict("legacyFree1");
    expect(await odb.getVerdictMeta("legacyFree1")).toMatchObject({ kind: "legacy", removedAt: at, removalReason: "operator" });
    expect(await verdictRemoved("legacyFree1")).toBe(true);
    expect((await getPublicVerdict("legacyFree1"))!.removed).toBe(true);
    expect(await n("SELECT count(*) AS n FROM verdicts WHERE id = 'legacyFree1'")).toBe(1);
    // Idempotent: the first removal time stays.
    expect(await removal.operatorRemoveVerdict("legacyFree1")).toBe(at);
  });

  it("account removal covers premium verdicts saved without an ownership row", async () => {
    const db = await getDb();
    await db.execute({ sql: "INSERT INTO verdicts (id, input, framework, result) VALUES ('latePrem1', 'x', '{}', ?)", args: [RESULT] });
    await db.execute({
      sql: `INSERT INTO premium_usage (id, user_id, funded_by, status, verdict_id, created_at, updated_at)
            VALUES ('pu3', 'user-p', 'credits', 'consumed', 'latePrem1', '2026-10-02T10:00:00.000Z', '2026-10-02T10:00:00.000Z')`,
    });
    await removal.removeUserData("user-p");
    for (const id of ["legacyPrem1", "latePrem1"]) {
      expect(await odb.getVerdictMeta(id)).toMatchObject({ removalReason: "account_deleted", ownerUserId: null });
      expect(await verdictRemoved(id)).toBe(true);
    }
    expect(await n("SELECT count(*) AS n FROM verdicts WHERE id IN ('legacyPrem1','latePrem1')")).toBe(2);
  });

  it("a case side removal closes every verdict of the case, including ones without an ownership row", async () => {
    const db = await getDb();
    const now = "2026-10-03T10:00:00.000Z";
    await db.execute({ sql: "INSERT INTO verdicts (id, input, framework, result) VALUES ('lateCase1', 'x', '{}', ?)", args: [RESULT] });
    await db.execute({
      sql: "INSERT INTO case_verdicts (case_id, seq, verdict_id, appeal_id, mode, created_at) VALUES ('case-legacy1', 2, 'lateCase1', NULL, 'two_sided', ?)",
      args: [now],
    });
    const { getCase } = await import("../lib/cases/db");
    const row = (await getCase("case-legacy1"))!;
    const res = await removal.removeCaseSide(row, "b", "party_b");
    expect(res.ok).toBe(true);
    for (const id of ["legacyCase1", "lateCase1"]) expect(await verdictRemoved(id)).toBe(true);
    expect(await n("SELECT count(*) AS n FROM case_verdicts WHERE case_id = 'case-legacy1'")).toBe(2);
  });
});
