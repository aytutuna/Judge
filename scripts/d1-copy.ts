/**
 * Copies the old SQLite database into a Workers deployment, table by table,
 * through its /api/internal/import route (see lib/d1-import.ts), then compares
 * the row counts. Run it against a copy of the database (a restored backup or
 * a sqlite3 .backup file), never the live file.
 *
 *   JOB_SECRET=... npx tsx scripts/d1-copy.ts <sqlite file> <https://worker-url>
 *
 * The Worker needs IMPORT_ENABLED=1 for the run. Running it again is safe:
 * rows are replaced by key, so the copy ends equal to the file.
 */
import { createClient } from "@libsql/client";
import { pathToFileURL } from "node:url";

const BATCH_ROWS = 50;
const BATCH_BYTES = 1_500_000;

/** Tables with the ones other tables point at first (foreign keys are enforced on D1). */
export async function copyOrder(db: ReturnType<typeof createClient>): Promise<string[]> {
  const rs = await db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite!_%' ESCAPE '!' ORDER BY name");
  const names = rs.rows.map((r) => String(r.name));
  const needs = new Map<string, Set<string>>();
  for (const name of names) {
    const fks = await db.execute(`PRAGMA foreign_key_list("${name}")`);
    needs.set(name, new Set(fks.rows.map((r) => String(r.table)).filter((t) => t !== name)));
  }
  const order: string[] = [];
  while (order.length < names.length) {
    const next = names.find((n) => !order.includes(n) && [...needs.get(n)!].every((t) => order.includes(t) || !names.includes(t)));
    if (!next) throw new Error("foreign keys form a cycle");
    order.push(next);
  }
  return order;
}

async function post(base: string, secret: string, body: unknown): Promise<Response> {
  return fetch(`${base}/api/internal/import`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": secret },
    body: JSON.stringify(body),
  });
}

export async function copyDatabase(file: string, base: string, secret: string, log: (s: string) => void = console.log): Promise<boolean> {
  const db = createClient({ url: `file:${file.replaceAll("\\", "/")}` });
  const sent: Record<string, number> = {};
  for (const table of await copyOrder(db)) {
    const info = await db.execute(`PRAGMA table_info("${table}")`);
    const columns = info.rows.map((r) => String(r.name));
    let rows: (string | number | null)[][] = [];
    let bytes = 0;
    const flush = async () => {
      if (!rows.length) return;
      const res = await post(base, secret, { table, columns, rows });
      if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
      sent[table] = (sent[table] ?? 0) + rows.length;
      rows = [];
      bytes = 0;
    };
    sent[table] = 0;
    const all = await db.execute(`SELECT ${columns.map((c) => `"${c}"`).join(", ")} FROM "${table}"`);
    for (const r of all.rows) {
      const row = columns.map((c) => {
        const v = r[c];
        if (typeof v === "bigint") throw new Error(`${table}.${c} holds an integer D1 cannot keep exactly`);
        return v as string | number | null;
      });
      const size = row.reduce<number>((n, v) => n + (typeof v === "string" ? v.length : 8), 0);
      if (rows.length && (rows.length >= BATCH_ROWS || bytes + size > BATCH_BYTES)) await flush();
      rows.push(row);
      bytes += size;
    }
    await flush();
    log(`${table}: ${sent[table]} rows sent`);
  }
  const counts = (await (await fetch(`${base}/api/internal/import`, { headers: { "x-internal-secret": secret } })).json()) as Record<string, number>;
  let same = true;
  for (const [table, n] of Object.entries(sent)) {
    if (counts[table] !== n) {
      same = false;
      log(`MISMATCH ${table}: sent ${n}, D1 has ${counts[table]}`);
    }
  }
  return same;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [file, base] = process.argv.slice(2);
  const secret = process.env.JOB_SECRET;
  if (!file || !base || !secret) {
    console.error("Usage: JOB_SECRET=... npx tsx scripts/d1-copy.ts <sqlite file> <worker url>");
    process.exit(2);
  }
  copyDatabase(file, base.replace(/\/$/, ""), secret).then(
    (ok) => {
      console.log(ok ? "row counts match" : "ROW COUNTS DIFFER");
      process.exit(ok ? 0 : 1);
    },
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
