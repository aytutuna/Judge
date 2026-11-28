/**
 * Opens a backup made by lib/backup.ts (a .sql.gz.jbk file from the BACKUPS
 * bucket) and either writes the SQL out or, with --drill, loads it into a
 * scratch SQLite file and checks it, which is the monthly restore drill.
 *
 *   BACKUP_PASSPHRASE=... npx tsx scripts/backup-open.ts <file> [out.sql]
 *   BACKUP_PASSPHRASE=... npx tsx scripts/backup-open.ts <file> --drill
 *   BACKUP_PASSPHRASE=... npx tsx scripts/backup-open.ts <file> --sqlite <out.db>
 *
 * Get the file with:
 *   npx wrangler r2 object get judge-backups/db/<name> --remote --jurisdiction eu --file <file>
 * To put it back into D1, make a SQLite file with --sqlite and load that with
 * scripts/d1-copy.ts: wrangler d1 execute --file cannot take a row over about
 * 100 KB (a long verdict or a sealed original), and those only go in as bound values.
 */
import { createClient } from "@libsql/client";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { backupKey, frameAad, MAGIC } from "../lib/backup";

/** The SQL inside a sealed backup. Throws when the passphrase is wrong or the file was cut or changed. */
export async function openBackup(file: Uint8Array, passphrase: string): Promise<string> {
  const magic = new TextDecoder().decode(file.subarray(0, MAGIC.length));
  if (magic !== MAGIC) throw new Error("not a Judge backup");
  const key = await backupKey(passphrase, file.subarray(MAGIC.length, MAGIC.length + 16));
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const plain: Buffer[] = [];
  let at = MAGIC.length + 16;
  for (let index = 0; ; index++) {
    const size = view.getUint32(at);
    const iv = file.subarray(at + 4, at + 16);
    const body = file.subarray(at + 16, at + 4 + size);
    at += 4 + size;
    const last = at >= file.length;
    plain.push(
      Buffer.from(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: frameAad(index, last) as BufferSource }, key, body as BufferSource)),
    );
    if (last) break;
  }
  return gunzipSync(Buffer.concat(plain)).toString("utf8");
}

async function drill(sql: string): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "judge-drill-"));
  const db = createClient({ url: `file:${path.join(dir, "drill.db").replaceAll("\\", "/")}` });
  try {
    await db.executeMultiple(sql.replace(/^\s*(BEGIN TRANSACTION;|COMMIT;)\s*$/gm, ""));
    const check = await db.execute("PRAGMA integrity_check");
    if (String(check.rows[0]?.integrity_check) !== "ok") throw new Error(`integrity check: ${JSON.stringify(check.rows)}`);
    for (const table of ["user", "verdicts", "entitlement_accounts"]) {
      const n = await db.execute(`SELECT COUNT(*) AS n FROM "${table}"`);
      console.log(`${table}: ${n.rows[0].n} rows`);
    }
    console.log("restore drill passed");
  } finally {
    db.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

async function main(): Promise<void> {
  const [file, second, third] = process.argv.slice(2);
  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (!file || !passphrase) {
    console.error("Usage: BACKUP_PASSPHRASE=... npx tsx scripts/backup-open.ts <file> [out.sql | --drill]");
    process.exit(2);
  }
  const sql = await openBackup(readFileSync(file), passphrase);
  if (second === "--drill") await drill(sql);
  else if (second === "--sqlite") {
    const out = third;
    if (!out) throw new Error("--sqlite needs an output path");
    const db = createClient({ url: `file:${out.replaceAll("\\", "/")}` });
    await db.executeMultiple(sql.replace(/^\s*(BEGIN TRANSACTION;|COMMIT;)\s*$/gm, ""));
    db.close();
  }
  else if (second) writeFileSync(second, sql);
  else process.stdout.write(sql);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().then(
    () => process.exit(0),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
