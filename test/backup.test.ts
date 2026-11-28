import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { backupConfigured, PBKDF2_ROUNDS, pruneBackups, runBackup, type BackupEnv } from "../lib/backup";
import { literal } from "../lib/backup-dump";
import { openBackup } from "../scripts/backup-open";

/** An R2 bucket in memory, with multipart uploads. */
function fakeBucket() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    createMultipartUpload: async (key: string) => {
      const parts: Uint8Array[] = [];
      return {
        uploadPart: async (n: number, data: Uint8Array) => {
          parts[n - 1] = data;
          return { partNumber: n, etag: String(n) };
        },
        complete: async () => {
          objects.set(key, Buffer.concat(parts));
        },
        abort: async () => undefined,
      };
    },
    list: async ({ prefix }: { prefix: string }) => ({
      objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })),
      truncated: false,
    }),
    delete: async (keys: string[]) => void keys.forEach((k) => objects.delete(k)),
  };
}

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), "judge-bk-"));
  return createClient({ url: `file:${path.join(dir, "b.db").replaceAll("\\", "/")}` });
}

/** A database with the real schema and rows that are awkward to write as SQL. */
async function filled() {
  const db = scratch();
  await db.executeMultiple(readFileSync(new URL("../migrations/0001_schema.sql", import.meta.url), "utf8"));
  const odd = ["plain", "it's \"quoted\"", "line\nbreak\r\nand tab\t", "emoji \u{1F600} and é", "nul\u0000inside", "", "-- not a comment; DROP TABLE x;"];
  await db.batch(
    odd.map((text, i) => ({ sql: "INSERT INTO verdicts (id, input, framework, result) VALUES (?, ?, '{}', ?)", args: [`v${i}`, text, JSON.stringify({ text })] })),
    "write",
  );
  await db.execute({ sql: "INSERT INTO verdicts (id, input, framework, result) VALUES ('big', ?, '{}', '{}')", args: ["x".repeat(500_000)] });
  await db.execute({ sql: "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('u1', 'N', 'n@example.test', 1, 1700000000000, 1700000000000)", args: [] });
  await db.execute({ sql: "INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt) VALUES ('a1', 'x', 'email', 'u1', 1700000000000, 1700000000000)", args: [] });
  return db;
}

async function rowsOf(db: ReturnType<typeof scratch>, table: string) {
  return (await db.execute(`SELECT * FROM "${table}" ORDER BY 1`)).rows.map((r) => ({ ...r }));
}

const PASS = "correct horse battery staple";
const env = (bucket: ReturnType<typeof fakeBucket>): BackupEnv => ({ BACKUPS: bucket as never, BACKUP_PASSPHRASE: PASS });

describe("backups", { timeout: 60_000 }, () => {
  it("restore drill: a sealed copy opens with the passphrase and loads into an empty database with every row", async () => {
    const source = await filled();
    const bucket = fakeBucket();
    const done = await runBackup(env(bucket), source, new Date("2026-12-01T03:30:00Z"));
    expect(done.key).toBe("db/judge-2026-12-01T03-30-00-000Z.sql.gz.jbk");
    const stored = bucket.objects.get(done.key)!;
    expect(stored.length).toBe(done.bytes);
    expect(Buffer.from(stored).includes("INSERT INTO")).toBe(false);

    const sql = await openBackup(stored, PASS);
    const restored = scratch();
    await restored.executeMultiple(sql);
    expect((await restored.execute("PRAGMA integrity_check")).rows[0].integrity_check).toBe("ok");
    for (const table of ["verdicts", "user", "account", "entitlement_accounts"]) {
      expect(await rowsOf(restored, table), table).toEqual(await rowsOf(source, table));
    }
    const tables = async (d: ReturnType<typeof scratch>) =>
      (await d.execute("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite!_%' ESCAPE '!' ORDER BY type, name")).rows.map((r) => `${r.type}:${r.name}`);
    expect(await tables(restored)).toEqual(await tables(source));
    await expect(openBackup(stored, "wrong")).rejects.toThrow();
  });

  it("restores cleanly when a user signs up while the dump runs: the account row whose user was missed is dropped", async () => {
    const source = await filled();
    let signedUp = false;
    const racing = {
      execute: async (stmt: string | { sql: string; args?: never[] }) => {
        const sql = typeof stmt === "string" ? stmt : stmt.sql;
        if (!signedUp && sql.includes('FROM "account"')) {
          signedUp = true;
          await source.execute("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('u2', 'M', 'm@example.test', 1, 1700000000001, 1700000000001)");
          await source.execute("INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt) VALUES ('a2', 'y', 'email', 'u2', 1700000000001, 1700000000001)");
        }
        return source.execute(stmt);
      },
      batch: source.batch.bind(source),
    };
    const bucket = fakeBucket();
    const done = await runBackup(env(bucket), racing as never, new Date("2026-12-01T03:30:00Z"));
    expect(signedUp).toBe(true);
    const restored = scratch();
    await restored.executeMultiple(await openBackup(bucket.objects.get(done.key)!, PASS));
    expect((await restored.execute("SELECT id FROM account ORDER BY id")).rows.map((r) => r.id)).toEqual(["a1"]);
    await restored.execute("PRAGMA foreign_keys = on");
    expect((await restored.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
  });

  it("pages through a table of more rows than one page holds", async () => {
    const source = scratch();
    await source.execute("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT)");
    await source.batch(Array.from({ length: 1234 }, (_, i) => ({ sql: "INSERT INTO t VALUES (?, ?)", args: [`k${i}`, `value ${i}`] })), "write");
    const bucket = fakeBucket();
    const done = await runBackup(env(bucket), source, new Date("2026-12-01T03:30:00Z"));
    const restored = scratch();
    await restored.executeMultiple(await openBackup(bucket.objects.get(done.key)!, PASS));
    expect(await rowsOf(restored, "t")).toEqual(await rowsOf(source, "t"));
  });

  it("notices a copy that was cut short", async () => {
    const source = scratch();
    await source.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    const noise = () => Buffer.from(crypto.getRandomValues(new Uint8Array(30_000))).toString("hex");
    await source.batch(Array.from({ length: 150 }, (_, i) => ({ sql: "INSERT INTO t VALUES (?, ?)", args: [i, noise()] })), "write");
    const bucket = fakeBucket();
    const done = await runBackup(env(bucket), source, new Date("2026-12-01T03:30:00Z"));
    const stored = bucket.objects.get(done.key)!;
    const view = new DataView(stored.buffer, stored.byteOffset);
    const firstFrame = 4 + 16 + 4 + view.getUint32(20);
    expect(firstFrame).toBeLessThan(stored.length);
    await expect(openBackup(stored.subarray(0, firstFrame), PASS)).rejects.toThrow();
  });

  it("keeps the key derivation within what Workers run (an earlier 310,000 failed on the first deploy)", () => {
    expect(PBKDF2_ROUNDS).toBeLessThanOrEqual(100_000);
  });

  it("still drops old copies when tonight's backup fails, but never the newest one", async () => {
    const bucket = fakeBucket();
    for (const day of ["2026-10-01", "2026-10-02"]) bucket.objects.set(`db/judge-${day}T03-30-00-000Z.sql.gz.jbk`, new Uint8Array(1));
    const broken = { execute: async () => { throw new Error("D1 is down"); }, batch: async () => [] };
    await expect(runBackup(env(bucket), broken as never, new Date("2026-12-01T03:30:00Z"))).rejects.toThrow(/down/);
    expect([...bucket.objects.keys()]).toEqual(["db/judge-2026-10-02T03-30-00-000Z.sql.gz.jbk"]);
  });

  it("deletes copies older than the keep period and no others", async () => {
    const bucket = fakeBucket();
    for (const day of ["2026-11-01", "2026-11-20", "2026-11-30"]) bucket.objects.set(`db/judge-${day}T03-30-00-000Z.sql.gz.jbk`, new Uint8Array(1));
    expect(await pruneBackups(bucket as never, new Date("2026-12-01T00:00:00Z"), 14)).toBe(1);
    expect([...bucket.objects.keys()]).toEqual(["db/judge-2026-11-20T03-30-00-000Z.sql.gz.jbk", "db/judge-2026-11-30T03-30-00-000Z.sql.gz.jbk"]);
  });

  it("is only configured with the bucket and the passphrase, and writes literals SQLite reads back", () => {
    expect(backupConfigured({ BACKUPS: {} as never })).toBe(false);
    expect(backupConfigured(env(fakeBucket()))).toBe(true);
    expect(literal("a'b")).toBe("'a''b'");
    expect(literal(null)).toBe("NULL");
    expect(literal(5)).toBe("5");
    expect(() => literal(new Uint8Array([1]))).toThrow(/BLOB/);
  });
});
