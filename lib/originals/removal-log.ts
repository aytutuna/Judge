/**
 * Append-only log of removals, kept OUTSIDE the database file (by default
 * `removals.log` beside it; REMOVAL_LOG overrides the path, "off" disables
 * it). Restoring a database backup taken before a removal would bring the
 * removed originals, names and share links back; replaying this log after a
 * restore (scripts/originals.ts replay-removals, run by verdict-restore)
 * applies every removal again. One JSON object per line: ids, party, reason
 * and time, never any text or names. Server only.
 */

import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { RemovalReason } from "@/lib/originals-types";

export type RemovalLogEntry =
  | { v: 1; at: string; kind: "verdict"; id: string; reason: RemovalReason }
  | { v: 1; at: string; kind: "case_side"; id: string; party: "a" | "b"; reason: RemovalReason }
  | { v: 1; at: string; kind: "account"; id: string };

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
  const file = removalLogPath();
  if (!file) return;
  try {
    await appendFile(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (e) {
    console.error(
      `[removal-log] could not record a removal in ${file} (a database restore would not re-apply it):`,
      JSON.stringify(entry),
      e instanceof Error ? e.message : String(e),
    );
  }
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const REASONS: readonly RemovalReason[] = ["owner", "party_a", "party_b", "account_deleted", "operator"];

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
      return reason && (r.party === "a" || r.party === "b")
        ? { v: 1, at: r.at, kind: "case_side", id: r.id, party: r.party, reason }
        : null;
    case "account":
      return { v: 1, at: r.at, kind: "account", id: r.id };
    default:
      return null;
  }
}

/** Every valid entry in file order, plus the count of lines skipped. A
 * missing file reads as empty. */
export async function readRemovalLog(file: string): Promise<{ entries: RemovalLogEntry[]; skipped: number } | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
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
