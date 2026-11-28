/**
 * Nightly encrypted copy of the D1 database in R2, next to D1's own 30-day
 * Time Travel. The database is dumped as SQL through the D1 binding (no API
 * token in the Worker), gzipped, and sealed with a key made from
 * BACKUP_PASSPHRASE. File format: "JBK1", a 16-byte salt, then frames of
 * [4-byte length][12-byte iv][AES-256-GCM ciphertext and tag], each frame
 * bound to its position and to whether it is the last. scripts/backup-open.ts
 * reads it back. Copies older than BACKUP_KEEP_DAYS are deleted.
 */

import type { R2Bucket } from "@cloudflare/workers-types/index";
import { dumpStream } from "./backup-dump";
import type { Db } from "./d1";

export const BACKUP_PREFIX = "db/";
export const MAGIC = "JBK1";
const FRAME_BYTES = 1024 * 1024;
const PART_BYTES = 8 * 1024 * 1024;
/** The most Workers allow; the passphrase is a long random string, so the count matters little. */
export const PBKDF2_ROUNDS = 100_000;
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

export type BackupEnv = {
  BACKUPS: R2Bucket;
  BACKUP_PASSPHRASE: string;
  BACKUP_KEEP_DAYS?: string;
};

export function backupConfigured(env: Partial<BackupEnv>): env is BackupEnv {
  return Boolean(env.BACKUPS && env.BACKUP_PASSPHRASE);
}

const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-");

/** Dumps (lib/backup-dump.ts), compresses, seals and stores one copy; then
 * drops the old ones. Returns the object's key and size. Throws when any step fails. */
export async function runBackup(
  env: BackupEnv,
  db: Db,
  now: Date = new Date(),
): Promise<{ key: string; bytes: number; deleted: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await backupKey(env.BACKUP_PASSPHRASE, salt);
  const gzipped = dumpStream(db).pipeThrough(new CompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  const name = `${BACKUP_PREFIX}judge-${stamp(now)}.sql.gz.jbk`;
  const bytes = await putStream(env.BACKUPS, name, sealStream(gzipped, key, salt));
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
