import { createClient, type Client } from "@libsql/client";
import type { Lang } from "./i18n";
import { VerdictResult } from "./types";

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
};

export async function saveVerdict(entry: {
  id: string;
  input: string;
  result: VerdictResult;
}): Promise<void> {
  const client = await db();
  await client.execute({
    sql: "INSERT INTO verdicts (id, input, framework, result) VALUES (?, ?, ?, ?)",
    args: [
      entry.id,
      entry.input,
      STORED_FRAMEWORK,
      JSON.stringify(entry.result),
    ],
  });
}

export async function getVerdict(id: string): Promise<StoredVerdict | null> {
  const client = await db();
  const rs = await client.execute({
    sql: "SELECT id, input, result, created_at FROM verdicts WHERE id = ?",
    args: [id],
  });
  const row = rs.rows[0];
  if (!row) return null;
  const parsed = VerdictResult.safeParse(JSON.parse(String(row.result)));
  if (!parsed.success) return null;
  return {
    id: String(row.id),
    input: String(row.input),
    result: parsed.data,
    createdAt: String(row.created_at),
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
  return parsed.success ? parsed.data : null;
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
