/**
 * Builds migrations/0001_schema.sql, the D1 schema, by running every ensure
 * step the Node server runs at startup (and Better Auth's own migrations)
 * against a fresh SQLite file and dumping what they made.
 *
 *   npx tsx scripts/d1-schema.ts          write the file
 *   npx tsx scripts/d1-schema.ts --check  fail when the file is out of date
 *
 * A schema change then needs a new numbered migration; the check (and
 * test/d1-schema.test.ts) tells you when the ensure code and the migrations
 * have drifted apart.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OUT = path.join(__dirname, "../migrations/0001_schema.sql");

/** The schema the ensure code makes, one statement per entry, tables first. */
export async function currentSchema(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "judge-schema-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "schema.db").replaceAll("\\", "/")}`;
  process.env.BETTER_AUTH_SECRET = randomBytes(24).toString("hex");
  process.env.RESEND_API_KEY = "re_schema";
  try {
    const [{ getDb }, { authReady }, { ensureAnalyticsTables }, { ensureVerdictJobTables }, { ensureSignInTokenTables }] =
      await Promise.all([
        import("../lib/db"),
        import("../lib/auth"),
        import("../lib/analytics/db"),
        import("../lib/verdict-jobs"),
        import("../lib/signin-tokens"),
      ]);
    await authReady();
    await Promise.all([ensureAnalyticsTables(), ensureVerdictJobTables(), ensureSignInTokenTables()]);
    const db = await getDb();
    const rs = await db.execute(
      `SELECT type, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
       ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`,
    );
    return rs.rows.map((r) => `${String(r.sql)};\n`).join("\n");
  } finally {
    // The open database file cannot be removed on Windows.
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

async function main(): Promise<void> {
  const sql = await currentSchema();
  if (process.argv.includes("--check")) {
    const stale = readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") !== sql;
    if (stale) {
      console.error("migrations/0001_schema.sql is out of date: run npx tsx scripts/d1-schema.ts");
      process.exit(1);
    }
    return;
  }
  writeFileSync(OUT, sql);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().then(() => process.exit(0));
}
