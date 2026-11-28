/**
 * Nightly encrypted copy of the D1 database in R2, next to D1's own 30-day
 * Time Travel. The database is exported through Cloudflare's export API (a
 * consistent snapshot as SQL), gzipped, and sealed with a key made from
 * BACKUP_PASSPHRASE. File format: "JBK1", a 16-byte salt, then frames of
 * [4-byte length][12-byte iv][AES-256-GCM ciphertext and tag], each frame
 * bound to its position and to whether it is the last. scripts/backup-open.ts
 * reads it back. Copies older than BACKUP_KEEP_DAYS are deleted.
 */

import type { R2Bucket } from "@cloudflare/workers-types/index";

export const BACKUP_PREFIX = "db/";
export const MAGIC = "JBK1";
const FRAME_BYTES = 1024 * 1024;
const PART_BYTES = 8 * 1024 * 1024;
const PBKDF2_ROUNDS = 310_000;
const KEEP_DAYS = 14;

export async function backupKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: PBKDF2_ROUNDS },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Position and finality, so frames cannot be reordered, dropped from the end or repeated. */
export function frameAad(index: number, last: boolean): Uint8Array {
  const aad = new Uint8Array(5);
  new DataView(aad.buffer).setUint32(0, index);
  aad[4] = last ? 1 : 0;
  return aad;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!a.length) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** Seals a stream of plaintext into the backup format, in frames of at most FRAME_BYTES. */
export function sealStream(plain: ReadableStream<Uint8Array>, key: CryptoKey, salt: Uint8Array): ReadableStream<Uint8Array> {
  const reader = plain.getReader();
  let index = 0;
  let pending: Uint8Array = new Uint8Array(0);
  let done = false;
  let header = true;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (header) {
        header = false;
        controller.enqueue(concat(new TextEncoder().encode(MAGIC), salt));
        return;
      }
      while (!done && pending.length <= FRAME_BYTES) {
        const next = await reader.read();
        if (next.done) done = true;
        else pending = concat(pending, next.value);
      }
      const last = done && pending.length <= FRAME_BYTES;
      const chunk = pending.subarray(0, FRAME_BYTES);
      pending = pending.subarray(chunk.length);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const body = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: frameAad(index++, last) as BufferSource }, key, chunk as BufferSource),
      );
      const frame = new Uint8Array(4 + 12 + body.length);
      new DataView(frame.buffer).setUint32(0, 12 + body.length);
      frame.set(iv, 4);
      frame.set(body, 16);
      controller.enqueue(frame);
      if (last) controller.close();
    },
  });
}

/** Writes a stream to R2 in parts, so a large copy never sits in memory. */
async function putStream(bucket: R2Bucket, key: string, body: ReadableStream<Uint8Array>): Promise<number> {
  const upload = await bucket.createMultipartUpload(key);
  const parts: { partNumber: number; etag: string }[] = [];
  let buffer: Uint8Array = new Uint8Array(0);
  let total = 0;
  const flush = async (data: Uint8Array) => {
    parts.push(await upload.uploadPart(parts.length + 1, data));
    total += data.length;
  };
  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer = concat(buffer, value);
      while (buffer.length >= PART_BYTES) {
        await flush(buffer.slice(0, PART_BYTES));
        buffer = buffer.slice(PART_BYTES);
      }
      if (done) break;
    }
    await flush(buffer);
    await upload.complete(parts);
  } catch (e) {
    await upload.abort().catch(() => undefined);
    throw e;
  }
  return total;
}

type ExportReply = {
  success: boolean;
  result?: { status?: string; at_bookmark?: string; error?: string; result?: { signed_url?: string } };
};

/** Asks D1 for an export and waits for its download link. */
async function exportUrl(env: BackupEnv, fetcher: typeof fetch): Promise<string> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${env.D1_DATABASE_ID}/export`;
  let bookmark: string | undefined;
  for (let i = 0; i < 60; i++) {
    const res = await fetcher(url, {
      method: "POST",
      headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ output_format: "polling", ...(bookmark ? { current_bookmark: bookmark } : {}) }),
    });
    const reply = (await res.json()) as ExportReply;
    if (!res.ok || !reply.success) throw new Error(`export API answered HTTP ${res.status}`);
    if (reply.result?.status === "error") throw new Error(`export failed: ${reply.result.error ?? "unknown"}`);
    const link = reply.result?.result?.signed_url;
    if (reply.result?.status === "complete" && link) return link;
    bookmark = reply.result?.at_bookmark ?? bookmark;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("the export did not finish in 2 minutes");
}

export type BackupEnv = {
  BACKUPS: R2Bucket;
  CLOUDFLARE_ACCOUNT_ID: string;
  D1_DATABASE_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  BACKUP_PASSPHRASE: string;
  BACKUP_KEEP_DAYS?: string;
};

export function backupConfigured(env: Partial<BackupEnv>): env is BackupEnv {
  return Boolean(env.BACKUPS && env.CLOUDFLARE_ACCOUNT_ID && env.D1_DATABASE_ID && env.CLOUDFLARE_API_TOKEN && env.BACKUP_PASSPHRASE);
}

const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-");

/** Exports, compresses, seals and stores one copy; then drops the old ones.
 * Returns the object's key and size. Throws when any step fails. */
export async function runBackup(
  env: BackupEnv,
  now: Date = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<{ key: string; bytes: number; deleted: number }> {
  const link = await exportUrl(env, fetcher);
  const dump = await fetcher(link);
  if (!dump.ok || !dump.body) throw new Error(`download answered HTTP ${dump.status}`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await backupKey(env.BACKUP_PASSPHRASE, salt);
  const sealed = sealStream(dump.body.pipeThrough(new CompressionStream("gzip")) as ReadableStream<Uint8Array>, key, salt);
  const name = `${BACKUP_PREFIX}judge-${stamp(now)}.sql.gz.jbk`;
  const bytes = await putStream(env.BACKUPS, name, sealed);
  return { key: name, bytes, deleted: await pruneBackups(env.BACKUPS, now, Number(env.BACKUP_KEEP_DAYS) || KEEP_DAYS) };
}

/** Deletes copies older than `days` (their names sort by time). */
export async function pruneBackups(bucket: R2Bucket, now: Date, days: number): Promise<number> {
  const oldest = `${BACKUP_PREFIX}judge-${stamp(new Date(now.getTime() - days * 86_400_000))}`;
  let dropped = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: BACKUP_PREFIX, cursor });
    const old = page.objects.filter((o) => o.key < oldest).map((o) => o.key);
    if (old.length) await bucket.delete(old);
    dropped += old.length;
    cursor = page.truncated && old.length === page.objects.length ? page.cursor : undefined;
  } while (cursor);
  return dropped;
}
