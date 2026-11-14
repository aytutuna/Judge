import { createClient, type Client } from "@libsql/client";
import type { Lang } from "./i18n";
import { signal } from "./signals";
import { VerdictResult } from "./types";
import { parseVenue, type Venue } from "./venues";

/** DATABASE_URL: `file:./dev.db` locally (relative to the working directory),
 * `libsql://<db>.turso.io` + DATABASE_AUTH_TOKEN in production. A bare path
 * is treated as a local file, as before. */
function dbUrl(): string {
  const url = process.env.DATABASE_URL || "file:./dev.db";
  return /^(file|libsql|https?|wss?):/i.test(url) ? url : `file:${url}`;
}

function createDb(): Client {
  return createClient({
    url: dbUrl(),
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });
}

// Reuse one client (and its schema check) across Next.js dev hot reloads and
// warm serverless invocations.
const globalForDb = globalThis as unknown as {
  __verdictLibsql?: Client;
  __verdictLibsqlReady?: Promise<void>;
};

/** Columns added after the first version. `erased_at`: when the 30-day wipe
 * blanked the text (lib/erasure). `legal_hold`: set by hand in SQL, never
 * through the app, to keep a verdict out of that wipe. */
const ADDED_VERDICT_COLUMNS: [string, string][] = [
  ["venue", "TEXT"],
  ["erased_at", "TEXT"],
  ["legal_hold", "INTEGER NOT NULL DEFAULT 0"],
];

async function migrate(client: Client): Promise<void> {
  // WAL only applies to a local file; remote libSQL manages its own journal.
  if (dbUrl().startsWith("file:")) await client.execute("PRAGMA journal_mode = WAL");
  await client.execute(`CREATE TABLE IF NOT EXISTS verdicts (
    id TEXT PRIMARY KEY,
    input TEXT NOT NULL,
    framework TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  // One stored translation per (verdict, language). The primary key is the
  // cross-process backstop against computing the same pair twice.
  await client.execute(`CREATE TABLE IF NOT EXISTS verdict_translations (
    id TEXT NOT NULL,
    lang TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (id, lang)
  )`);
  const info = await client.execute("PRAGMA table_info(verdicts)");
  const have = new Set(info.rows.map((r) => String(r.name)));
  for (const [name, type] of ADDED_VERDICT_COLUMNS) {
    if (have.has(name)) continue;
    try {
      await client.execute(`ALTER TABLE verdicts ADD COLUMN ${name} ${type}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!/duplicate column name/i.test(message)) throw e;
    }
  }
}

async function db(): Promise<Client> {
  const client = (globalForDb.__verdictLibsql ??= createDb());
  globalForDb.__verdictLibsqlReady ??= migrate(client).catch((e: unknown) => {
    // Let the next request retry instead of caching the failure forever.
    globalForDb.__verdictLibsqlReady = undefined;
    throw e;
  });
  await globalForDb.__verdictLibsqlReady;
  return client;
}

/** The shared, migrated client, for modules that keep their own tables in the
 * same database (accounts, entitlements). */
export async function getDb(): Promise<Client> {
  return db();
}

/** What new verdict and case rows store in their NOT NULL framework column.
 * Every verdict is judged with this standard now; older rows may hold other
 * presets, which nothing reads any more. */
export const STORED_FRAMEWORK = '{"preset":"balanced"}';

export type StoredVerdict = {
  id: string;
  input: string;
  result: VerdictResult;
  createdAt: string;
  /** The scene the court is set in; null for verdicts from before venues. */
  venue: Venue | null;
};

export async function saveVerdict(entry: {
  id: string;
  input: string;
  result: VerdictResult;
  venue?: Venue | null;
}): Promise<void> {
  const client = await db();
  await client.execute({
    sql: "INSERT INTO verdicts (id, input, framework, result, venue) VALUES (?, ?, ?, ?, ?)",
    args: [
      entry.id,
      entry.input,
      STORED_FRAMEWORK,
      JSON.stringify(entry.result),
      entry.venue ?? null,
    ],
  });
}

/** Field paths of a zod failure, never the values. */
function issuePaths(error: { issues: { path: PropertyKey[] }[] }): string {
  return [...new Set(error.issues.map((i) => i.path.map(String).join(".")))].slice(0, 8).join(",");
}

export async function getVerdict(id: string): Promise<StoredVerdict | null> {
  const client = await db();
  const rs = await client.execute({
    sql: "SELECT id, input, result, created_at, venue FROM verdicts WHERE id = ?",
    args: [id],
  });
  const row = rs.rows[0];
  if (!row) return null;
  const parsed = VerdictResult.safeParse(JSON.parse(String(row.result)));
  if (!parsed.success) {
    signal("schema_drift", `verdict=${id} paths=${issuePaths(parsed.error)}`);
    return null;
  }
  return {
    id: String(row.id),
    input: String(row.input),
    result: parsed.data,
    createdAt: String(row.created_at),
    venue: parseVenue(row.venue),
  };
}

/** A stored translation, or null when there is none (or it no longer parses). */
export async function getTranslation(id: string, lang: Lang): Promise<VerdictResult | null> {
  const client = await db();
  const rs = await client.execute({
    sql: "SELECT result_json FROM verdict_translations WHERE id = ? AND lang = ?",
    args: [id, lang],
  });
  const row = rs.rows[0];
  if (!row) return null;
  const parsed = VerdictResult.safeParse(JSON.parse(String(row.result_json)));
  if (!parsed.success) {
    signal("schema_drift", `translation=${id}/${lang} paths=${issuePaths(parsed.error)}`);
    return null;
  }
  return parsed.data;
}

/** Stores a translation unless one already exists for the pair: the first
 * writer wins and later writers keep the stored copy. */
export async function saveTranslation(id: string, lang: Lang, result: VerdictResult): Promise<void> {
  const client = await db();
  await client.execute({
    sql: "INSERT OR IGNORE INTO verdict_translations (id, lang, result_json) VALUES (?, ?, ?)",
    args: [id, lang, JSON.stringify(result)],
  });
}
