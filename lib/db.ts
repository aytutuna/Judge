import Database from "better-sqlite3";
import path from "node:path";
import { VerdictResult, type FrameworkChoice } from "./types";

function dbPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const file = url.startsWith("file:") ? url.slice(5) : url;
  return path.isAbsolute(file) ? file : path.join(process.cwd(), file);
}

function createDb(): Database.Database {
  const db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS verdicts (
    id TEXT PRIMARY KEY,
    input TEXT NOT NULL,
    framework TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return db;
}

// Reuse one connection across Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { __verdictDb?: Database.Database };
const db = (globalForDb.__verdictDb ??= createDb());

export type StoredVerdict = {
  id: string;
  input: string;
  framework: FrameworkChoice;
  result: VerdictResult;
  createdAt: string;
};

export function saveVerdict(entry: {
  id: string;
  input: string;
  framework: FrameworkChoice;
  result: VerdictResult;
}): void {
  db.prepare(
    "INSERT INTO verdicts (id, input, framework, result) VALUES (?, ?, ?, ?)",
  ).run(
    entry.id,
    entry.input,
    JSON.stringify(entry.framework),
    JSON.stringify(entry.result),
  );
}

export function getVerdict(id: string): StoredVerdict | null {
  const row = db
    .prepare(
      "SELECT id, input, framework, result, created_at FROM verdicts WHERE id = ?",
    )
    .get(id) as
    | { id: string; input: string; framework: string; result: string; created_at: string }
    | undefined;
  if (!row) return null;
  const parsed = VerdictResult.safeParse(JSON.parse(row.result));
  if (!parsed.success) return null;
  return {
    id: row.id,
    input: row.input,
    framework: JSON.parse(row.framework) as FrameworkChoice,
    result: parsed.data,
    createdAt: row.created_at,
  };
}
