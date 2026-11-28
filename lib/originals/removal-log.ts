/**
 * Append-only log of removals, kept OUTSIDE the database file (by default
 * `removals.log` beside it; REMOVAL_LOG overrides the path, "off" disables
 * it). Restoring a database backup taken before a removal would bring the
 * removed originals, names and share links back; replaying this log after a
 * restore (scripts/originals.ts replay-removals, run by verdict-restore)
 * applies every removal again. One JSON object per line: ids, party, reason
 * and time (and, for an account, the sign-in token revocation outcome), never
 * any text, names or tokens. Entries older than RETENTION_MS are dropped
 * daily (pruneRemovalLog). On Workers each entry is its own object under
 * removals/ in the BACKUPS R2 bucket, which a D1 restore never touches. Server only.
 */

import type { PartyLetter as CaseParty } from "@/lib/case-types";
import { appendFile, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { workerEnv } from "@/lib/worker-env";
import type { RemovalReason } from "@/lib/originals-types";
import type { SignInRevocation } from "@/lib/signin-tokens";

export type RemovalLogEntry =
  | { v: 1; at: string; kind: "verdict"; id: string; reason: RemovalReason }
  | { v: 1; at: string; kind: "case_side"; id: string; party: CaseParty; reason: RemovalReason }
  | {
      v: 1;
      at: string;
      kind: "account";
      id: string;
      /** What became of the account's Sign in with Apple tokens (outcome
       * only, never a token). Informational: replay ignores it. */
      signInTokens?: SignInRevocation;
    };

export const RETENTION_MS = 90 * 24 * 60 * 60_000;

const BUCKET_PREFIX = "removals/";

/** Keys sort by time, so a listing is in log order. */
const bucketKey = (at: string) => `${BUCKET_PREFIX}${at}-${crypto.randomUUID().slice(0, 8)}.json`;

/** Appends and the daily rewrite take turns, so a removal logged while the
 * file is being rewritten is not lost. */
let turn: Promise<unknown> = Promise.resolve();
function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  const run = turn.then(fn, fn);
  turn = run.catch(() => undefined);
  return run;
}

/** Where the log lives, or null (disabled, or a remote database). */
export function removalLogPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const set = env.REMOVAL_LOG?.trim();
  if (set) return set.toLowerCase() === "off" ? null : set;
  const raw = env.DATABASE_URL || "file:./dev.db";
  const url = /^(file|libsql|https?|wss?):/i.test(raw) ? raw : `file:${raw}`;
  if (!url.startsWith("file:")) return null;
  const file = url.slice("file:".length).split("?")[0];
  if (!file || file === ":memory:") return null;
  return path.join(path.dirname(file), "removals.log");
}

/** Appends one entry. Never throws: the removal itself is already done in
 * the database; a failed append is logged loudly so the operator can add it. */
export async function appendRemovalLog(entry: RemovalLogEntry): Promise<void> {
  const bucket = workerEnv()?.BACKUPS;
  if (bucket) {
    try {
      await bucket.put(bucketKey(entry.at), JSON.stringify(entry));
    } catch (e) {
      console.error(
        "[removal-log] could not record a removal in R2 (a restore would not re-apply it):",
        JSON.stringify(entry),
        e instanceof Error ? e.message : String(e),
      );
    }
    return;
  }
  const file = removalLogPath();
  if (!file) return;
  try {
    await inTurn(() => appendFile(/* turbopackIgnore: true */ file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 }));
  } catch (e) {
    console.error(
      `[removal-log] could not record a removal in ${file} (a database restore would not re-apply it):`,
      JSON.stringify(entry),
      e instanceof Error ? e.message : String(e),
    );
  }
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const REASONS: readonly RemovalReason[] = ["owner", "party_a", "party_b", "party_c", "party_d", "account_deleted", "operator"];

/** One log line, validated; null for anything malformed. */
export function parseRemovalLogLine(line: string): RemovalLogEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.at !== "string" || Number.isNaN(Date.parse(r.at))) return null;
  if (typeof r.id !== "string" || !ID.test(r.id)) return null;
  const reason = REASONS.includes(r.reason as RemovalReason) ? (r.reason as RemovalReason) : null;
  switch (r.kind) {
    case "verdict":
      return reason ? { v: 1, at: r.at, kind: "verdict", id: r.id, reason } : null;
    case "case_side":
      return reason && (r.party === "a" || r.party === "b" || r.party === "c" || r.party === "d")
        ? { v: 1, at: r.at, kind: "case_side", id: r.id, party: r.party, reason }
        : null;
    case "account":
      return { v: 1, at: r.at, kind: "account", id: r.id };
    default:
      return null;
  }
}

/** Every valid entry in time order from the R2 log, plus the count skipped. */
export async function readRemovalBucket(): Promise<{ entries: RemovalLogEntry[]; skipped: number }> {
  const bucket = workerEnv()?.BACKUPS;
  const entries: RemovalLogEntry[] = [];
  let skipped = 0;
  if (!bucket) return { entries, skipped };
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: BUCKET_PREFIX, cursor });
    const bodies = await Promise.all(page.objects.map(async (o) => (await bucket.get(o.key))?.text() ?? ""));
    for (const line of bodies) {
      const entry = parseRemovalLogLine(line);
      if (entry) entries.push(entry);
      else skipped += 1;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { entries, skipped };
}

/** Every valid entry in file order, plus the count of lines skipped. A
 * missing file reads as empty. */
export async function readRemovalLog(file: string): Promise<{ entries: RemovalLogEntry[]; skipped: number } | null> {
  let text: string;
  try {
    text = await readFile(/* turbopackIgnore: true */ file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const entries: RemovalLogEntry[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry = parseRemovalLogLine(line);
    if (entry) entries.push(entry);
    else skipped += 1;
  }
  return { entries, skipped };
}

/** Drops the entries older than RETENTION_MS from the log file, keeping
 * every line it cannot read as an entry. Returns how many it dropped. A
 * missing file or a disabled log drops nothing. */
export async function pruneRemovalLog(now: Date = new Date()): Promise<number> {
  const bucket = workerEnv()?.BACKUPS;
  if (bucket) {
    const oldest = `${BUCKET_PREFIX}${new Date(now.getTime() - RETENTION_MS).toISOString()}`;
    let dropped = 0;
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: BUCKET_PREFIX, cursor });
      const old = page.objects.filter((o) => o.key < oldest).map((o) => o.key);
      if (old.length) await bucket.delete(old);
      dropped += old.length;
      cursor = page.truncated && old.length === page.objects.length ? page.cursor : undefined;
    } while (cursor);
    return dropped;
  }
  const file = removalLogPath();
  if (!file) return 0;
  const cutoff = now.getTime() - RETENTION_MS;
  return inTurn(async () => {
    let raw: string;
    try {
      raw = await readFile(/* turbopackIgnore: true */ file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw e;
    }
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    const kept = lines.filter((l) => {
      const entry = parseRemovalLogLine(l);
      return !entry || Date.parse(entry.at) >= cutoff;
    });
    if (kept.length === lines.length) return 0;
    const tmp = `${file}.tmp`;
    await writeFile(/* turbopackIgnore: true */ tmp, kept.map((l) => `${l}\n`).join(""), { encoding: "utf8", mode: 0o600 });
    await rename(/* turbopackIgnore: true */ tmp, file);
    return lines.length - kept.length;
  });
}
