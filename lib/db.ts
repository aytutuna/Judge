import { createClient, type Client, type Config } from "@libsql/client";
import { ensureSchema } from "./migrations";
import { VerdictResult, type FrameworkChoice } from "./types";

/** Turso when TURSO_DATABASE_URL is set, otherwise a local libSQL file
 * (DATABASE_URL, default `file:./dev.db`). */
export function dbConfig(env: Record<string, string | undefined> = process.env): Config {
  const tursoUrl = env.TURSO_DATABASE_URL?.trim();
  if (tursoUrl) {
    return { url: tursoUrl, authToken: env.TURSO_AUTH_TOKEN?.trim() || undefined };
  }
  // A file DB on Vercel would land on a read-only, per-instance disk and
  // silently lose every verdict, so refuse instead of falling back.
  if (env.VERCEL) {
    throw new Error("TURSO_DATABASE_URL is not set; a file database cannot persist on Vercel.");
  }
  return { url: env.DATABASE_URL?.trim() || "file:./dev.db" };
}

type DbState = { client: Client; ready: Promise<void> };

// Reuse one client across Next.js dev hot reloads. Created lazily so that
// importing this module (e.g. during `next build`) never touches the database.
const globalForDb = globalThis as unknown as { __verdictDb?: DbState };

async function getDb(): Promise<Client> {
  let state = globalForDb.__verdictDb;
  if (!state) {
    const client = createClient(dbConfig());
    state = { client, ready: ensureSchema(client) };
    globalForDb.__verdictDb = state;
  }
  try {
    await state.ready;
  } catch (err) {
    // Don't cache a failed setup (e.g. Turso briefly unreachable); the next
    // call starts over.
    if (globalForDb.__verdictDb === state) {
      globalForDb.__verdictDb = undefined;
      state.client.close();
    }
    throw err;
  }
  return state.client;
}

/** Closes the shared client; the next call opens a fresh one. */
export function closeDb(): void {
  globalForDb.__verdictDb?.client.close();
  globalForDb.__verdictDb = undefined;
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
  const db = await getDb();
  await db.execute({
    sql: "INSERT INTO verdicts (id, input, framework, result) VALUES (?, ?, ?, ?)",
    args: [entry.id, entry.input, JSON.stringify(entry.framework), JSON.stringify(entry.result)],
  });
}

export async function getVerdict(id: string): Promise<StoredVerdict | null> {
  const db = await getDb();
  const rs = await db.execute({
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
