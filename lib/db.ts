import { createClient, type Client } from "@libsql/client";
import { VerdictResult, type FrameworkChoice } from "./types";

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

export type StoredVerdict = {
  id: string;
  input: string;
  framework: FrameworkChoice;
  result: VerdictResult;
  createdAt: string;
};

export async function saveVerdict(entry: {
  id: string;
  input: string;
  framework: FrameworkChoice;
  result: VerdictResult;
}): Promise<void> {
  const client = await db();
  await client.execute({
    sql: "INSERT INTO verdicts (id, input, framework, result) VALUES (?, ?, ?, ?)",
    args: [
      entry.id,
      entry.input,
      JSON.stringify(entry.framework),
      JSON.stringify(entry.result),
    ],
  });
}

export async function getVerdict(id: string): Promise<StoredVerdict | null> {
  const client = await db();
  const rs = await client.execute({
    sql: "SELECT id, input, framework, result, created_at FROM verdicts WHERE id = ?",
    args: [id],
  });
  const row = rs.rows[0];
  if (!row) return null;
  const parsed = VerdictResult.safeParse(JSON.parse(String(row.result)));
  if (!parsed.success) return null;
  return {
    id: String(row.id),
    input: String(row.input),
    framework: JSON.parse(String(row.framework)) as FrameworkChoice,
    result: parsed.data,
    createdAt: String(row.created_at),
  };
}
