import { describe, expect, it } from "vitest";
import { backupConfigured, pruneBackups, runBackup, type BackupEnv } from "../lib/backup";
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

const SQL = `CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT);\n${Array.from({ length: 200 }, (_, i) => `INSERT INTO t VALUES ('${i}', 'row ${i}');`).join("\n")}\n`;

function fakeFetch() {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/export")) {
      return new Response(JSON.stringify({ success: true, result: { status: "complete", result: { signed_url: "https://dump.test/d.sql" } } }), { status: 200 });
    }
    return new Response(SQL, { status: 200 });
  }) as typeof fetch;
}

function env(bucket: ReturnType<typeof fakeBucket>): BackupEnv {
  return {
    BACKUPS: bucket as never,
    CLOUDFLARE_ACCOUNT_ID: "acct",
    D1_DATABASE_ID: "db",
    CLOUDFLARE_API_TOKEN: "token",
    BACKUP_PASSPHRASE: "correct horse battery staple",
  };
}

describe("backups", () => {
  it("stores an encrypted copy that opens with the passphrase and not without it", async () => {
    const bucket = fakeBucket();
    const done = await runBackup(env(bucket), new Date("2026-12-01T03:30:00Z"), fakeFetch());
    expect(done.key).toBe("db/judge-2026-12-01T03-30-00-000Z.sql.gz.jbk");
    const stored = bucket.objects.get(done.key)!;
    expect(stored.length).toBe(done.bytes);
    expect(Buffer.from(stored).includes("INSERT INTO")).toBe(false);
    expect(await openBackup(stored, "correct horse battery staple")).toBe(SQL);
    await expect(openBackup(stored, "wrong")).rejects.toThrow();
  });

  it("notices a copy that was cut short", async () => {
    const bucket = fakeBucket();
    const big = new Uint8Array(3 * 1024 * 1024);
    for (let at = 0; at < big.length; at += 65_536) crypto.getRandomValues(big.subarray(at, at + 65_536));
    const fetcher = (async (url: string | URL | Request) =>
      String(url).includes("/export")
        ? new Response(JSON.stringify({ success: true, result: { status: "complete", result: { signed_url: "https://dump.test/d.sql" } } }))
        : new Response(big)) as typeof fetch;
    const done = await runBackup(env(bucket), new Date("2026-12-01T03:30:00Z"), fetcher);
    const stored = bucket.objects.get(done.key)!;
    const view = new DataView(stored.buffer, stored.byteOffset);
    const firstFrame = 4 + 16 + 4 + view.getUint32(20);
    await expect(openBackup(stored.subarray(0, firstFrame), "correct horse battery staple")).rejects.toThrow();
  });

  it("deletes copies older than the keep period and no others", async () => {
    const bucket = fakeBucket();
    for (const day of ["2026-11-01", "2026-11-20", "2026-11-30"]) bucket.objects.set(`db/judge-${day}T03-30-00-000Z.sql.gz.jbk`, new Uint8Array(1));
    expect(await pruneBackups(bucket as never, new Date("2026-12-01T00:00:00Z"), 14)).toBe(1);
    expect([...bucket.objects.keys()]).toEqual(["db/judge-2026-11-20T03-30-00-000Z.sql.gz.jbk", "db/judge-2026-11-30T03-30-00-000Z.sql.gz.jbk"]);
  });

  it("is only configured with every setting", () => {
    expect(backupConfigured({ BACKUPS: {} as never, CLOUDFLARE_ACCOUNT_ID: "a" })).toBe(false);
    expect(backupConfigured(env(fakeBucket()))).toBe(true);
  });
});
