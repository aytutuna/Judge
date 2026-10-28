import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The Verdicts list's only schema change, an index on verdict_jobs, applied
 * to a database that already holds rows from before it: nothing is lost or
 * rewritten.
 */

const dir = mkdtempSync(path.join(tmpdir(), "verdict-history-migrate-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { getDb } = await import("../lib/db");
const jobs = await import("../lib/verdict-jobs");
const { saveVerdictWithOriginals } = await import("../lib/originals/save");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

async function counts(): Promise<Record<string, number>> {
  const db = await getDb();
  const tables = await db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const out: Record<string, number> = {};
  for (const t of tables.rows) {
    const name = String(t.name);
    out[name] = Number((await db.execute(`SELECT COUNT(*) AS n FROM "${name}"`)).rows[0].n);
  }
  return out;
}

async function hasIndex(name: string): Promise<boolean> {
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?", args: [name] });
  return rs.rows.length === 1;
}

describe("verdict_jobs_owner", () => {
  it("is added to a database with existing jobs and verdicts, every row kept as it was", async () => {
    await jobs.ensureVerdictJobTables();
    for (let i = 0; i < 3; i++) await jobs.createVerdictJob({ id: `job${i}`, kind: "premium", ownerUserId: i ? `u${i}` : null });
    await jobs.failVerdictJob("job1", "unavailable", null);
    await saveVerdictWithOriginals({
      id: "stored1",
      input: "x",
      result: {
        verdict: "side_a",
        dispute_type: "factual",
        headline: "Party A paid",
        crux: "c",
        split_points: null,
        conditional: null,
        argument_map: { side_a: [], side_b: [], bedrock_a: "a", bedrock_b: "b" },
        facts_relied_on: [],
        losing_side_best_point: "p",
        confidence: 4,
        runs: ["side_a", "side_a", "side_a"],
        demo: false,
        lang: "en",
      },
      kind: "premium",
      ownerUserId: "u1",
      original: { v: 1, text: "x", nameMap: [] },
    });

    // The database as an older server left it: no index yet.
    const db = await getDb();
    await db.execute("DROP INDEX verdict_jobs_owner");
    expect(await hasIndex("verdict_jobs_owner")).toBe(false);
    const before = await counts();
    const jobRows = (await db.execute("SELECT * FROM verdict_jobs ORDER BY id")).rows;
    (globalThis as unknown as { __verdictJobsReady?: unknown }).__verdictJobsReady = undefined;

    await jobs.ensureVerdictJobTables();
    expect(await hasIndex("verdict_jobs_owner")).toBe(true);
    expect(await counts()).toEqual(before);
    expect((await db.execute("SELECT * FROM verdict_jobs ORDER BY id")).rows).toEqual(jobRows);
    expect(before.verdict_jobs).toBe(3);
    expect(before.verdicts).toBe(1);

    // Running it again changes nothing.
    (globalThis as unknown as { __verdictJobsReady?: unknown }).__verdictJobsReady = undefined;
    await jobs.ensureVerdictJobTables();
    expect(await counts()).toEqual(before);
  });
});
