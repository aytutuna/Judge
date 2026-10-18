import type { Client } from "@libsql/client";

export type Migration = {
  /** Strictly increasing; never renumber or edit a migration once it has shipped. */
  version: number;
  name: string;
  statements: string[];
};

// Append new migrations at the end. Each one runs once per database, inside
// the same write transaction that records it in `schema_migrations`.
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "create_verdicts",
    // IF NOT EXISTS: databases created before migrations existed already have it.
    statements: [
      `CREATE TABLE IF NOT EXISTS verdicts (
        id TEXT PRIMARY KEY,
        input TEXT NOT NULL,
        framework TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ],
  },
];

export const LATEST_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

/** Applies every pending migration and returns the versions it ran. Safe to
 * run repeatedly and from several processes: the write transaction
 * serializes runners, and the second one finds nothing left to do. */
export async function migrate(client: Client): Promise<number[]> {
  const tx = await client.transaction("write");
  try {
    await tx.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    const rs = await tx.execute("SELECT version FROM schema_migrations");
    const applied = new Set(rs.rows.map((row) => Number(row.version)));

    const ran: number[] = [];
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      for (const sql of m.statements) await tx.execute(sql);
      await tx.execute({
        sql: "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
        args: [m.version, m.name],
      });
      ran.push(m.version);
    }
    await tx.commit();
    return ran;
  } finally {
    tx.close();
  }
}

/** Cheap read-only check first, so an up-to-date database (the normal case
 * on every cold start) never takes the write lock. */
export async function ensureSchema(client: Client): Promise<void> {
  try {
    const rs = await client.execute("SELECT MAX(version) AS version FROM schema_migrations");
    if (Number(rs.rows[0]?.version ?? 0) >= LATEST_VERSION) return;
  } catch {
    // No schema_migrations table yet: fall through and create it.
  }
  await migrate(client);
}
