/**
 * Operator tool for stored originals (the only place outside a writer's own
 * requests that decrypts them). Prints JSON to stdout.
 *
 *   npx tsx --env-file=.env scripts/originals.ts show <verdictId>
 *   npx tsx --env-file=.env scripts/originals.ts show-case <caseId> [a|b]
 *   npx tsx --env-file=.env scripts/originals.ts remove <verdictId>
 *   npx tsx --env-file=.env scripts/originals.ts remove-case <caseId> <a|b>
 *   npx tsx --env-file=.env scripts/originals.ts replay-removals [logFile]
 *
 * `replay-removals` applies every removal in the removal log again (default:
 * removals.log beside the database, or REMOVAL_LOG): run it right after
 * restoring a database backup, before starting the app (verdict-restore
 * does), so removals made after the backup was taken are not undone.
 * Accounts deleted after the backup are deleted again.
 *
 * `show*` needs a usable ORIGINALS_KEY (outside production the development
 * key is used, with a warning). `remove*` works without one: removal blanks
 * the sealed data, closes the links and never deletes a row.
 *
 * On the server, from the app directory:
 *   sudo -u verdict npx tsx --env-file=/etc/verdict/verdict.env scripts/originals.ts show <verdictId>
 */

import { pathToFileURL } from "node:url";
import { getCase } from "../lib/cases/db";
import { getVerdict } from "../lib/db";
import { partyOriginals } from "../lib/originals/cases";
import { aad, openOrNull, originalsKeyState } from "../lib/originals/crypto";
import { ensureOriginalsTables, getOriginal, getVerdictMeta, subjects } from "../lib/originals/db";
import { caseDisplayState, openVerdictDisplay } from "../lib/originals/display";
import { operatorRemoveVerdict, removeCaseSide, replayRemoval } from "../lib/originals/removal";
import { readRemovalLog, removalLogPath } from "../lib/originals/removal-log";

export const USAGE =
  "Usage: npx tsx --env-file=.env scripts/originals.ts (show <verdictId> | show-case <caseId> [a|b] | remove <verdictId> | remove-case <caseId> <a|b> | replay-removals [logFile])";

export type OriginalsCommand =
  | { kind: "show"; id: string }
  | { kind: "show-case"; id: string; party: "a" | "b" | null }
  | { kind: "remove"; id: string }
  | { kind: "remove-case"; id: string; party: "a" | "b" }
  | { kind: "replay-removals"; file: string | null };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const isParty = (v: string | undefined): v is "a" | "b" => v === "a" || v === "b";

export function parseOriginalsArgs(argv: readonly string[]): OriginalsCommand | { error: string } {
  const [cmd, id, party, ...rest] = argv;
  if (cmd === "replay-removals") {
    return party === undefined ? { kind: "replay-removals", file: id ?? null } : { error: USAGE };
  }
  if (!cmd || !id || !ID.test(id)) return { error: USAGE };
  switch (cmd) {
    case "show":
      return party === undefined ? { kind: "show", id } : { error: USAGE };
    case "remove":
      return party === undefined || (party === "--reason" && rest[0] === "operator") ? { kind: "remove", id } : { error: USAGE };
    case "show-case":
      if (party === undefined) return { kind: "show-case", id, party: null };
      return isParty(party) && rest.length === 0 ? { kind: "show-case", id, party } : { error: USAGE };
    case "remove-case":
      return isParty(party) && rest.length === 0 ? { kind: "remove-case", id, party } : { error: USAGE };
    default:
      return { error: USAGE };
  }
}

function needKey(): boolean {
  const state = originalsKeyState();
  if (!state.ok) {
    console.error(`ORIGINALS_KEY is ${state.reason}: cannot decrypt. Set it (the server's key) and try again.`);
    return false;
  }
  if (state.dev) console.error("Warning: ORIGINALS_KEY unset, using the development key.");
  return true;
}

export async function run(cmd: OriginalsCommand): Promise<number> {
  await ensureOriginalsTables();
  switch (cmd.kind) {
    case "show": {
      if (!needKey()) return 1;
      const stored = await getVerdict(cmd.id);
      if (!stored) {
        console.error("No verdict with that id.");
        return 1;
      }
      const meta = await getVerdictMeta(cmd.id);
      const subject = subjects.verdict(cmd.id);
      const row = await getOriginal(subject);
      print({
        id: cmd.id,
        createdAt: stored.createdAt,
        meta: meta && {
          kind: meta.kind,
          ownerUserId: meta.ownerUserId,
          tokenOwned: Boolean(meta.ownerTokenHash),
          caseId: meta.caseId,
          namesVisible: meta.namesVisible,
          removedAt: meta.removedAt,
          removalReason: meta.removalReason,
        },
        original: row?.sealed ? openOrNull(row.sealed, aad.original(subject), subject) : null,
        originalStatus: !row ? "not_stored" : row.sealed ? "stored" : "removed",
        display: meta && meta.kind !== "case" ? openVerdictDisplay(meta) : null,
        anonymizedInput: stored.input,
      });
      return 0;
    }
    case "show-case": {
      if (!needKey()) return 1;
      const row = await getCase(cmd.id);
      if (!row) {
        console.error("No case with that id.");
        return 1;
      }
      const parties = cmd.party ? [cmd.party] : (["a", "b"] as const);
      const out: Record<string, unknown> = {
        id: row.id,
        ownerId: row.ownerId,
        status: row.status,
        removedAt: row.removedAt,
        removedA: row.removedAAt,
        removedB: row.removedBAt,
        display: caseDisplayState(row),
      };
      for (const p of parties) out[p] = await partyOriginals(row, p);
      print(out);
      return 0;
    }
    case "remove": {
      const meta = await getVerdictMeta(cmd.id);
      if (meta?.kind === "case") {
        console.error(`This verdict belongs to case ${meta.caseId}: use remove-case <caseId> <a|b>.`);
        return 1;
      }
      if (!(await getVerdict(cmd.id))) {
        console.error("No verdict with that id.");
        return 1;
      }
      print({ id: cmd.id, removed: true, removedAt: await operatorRemoveVerdict(cmd.id) });
      return 0;
    }
    case "remove-case": {
      const row = await getCase(cmd.id);
      if (!row) {
        console.error("No case with that id.");
        return 1;
      }
      const res = await removeCaseSide(row, cmd.party, "operator");
      if (!res.ok) {
        console.error(res.code === "in_progress" ? "Something in this case is being judged: try again in a few minutes." : "No case with that id.");
        return 1;
      }
      print({ id: cmd.id, party: cmd.party, removed: true, removedAt: res.removedAt });
      return 0;
    }
    case "replay-removals":
      return replayRemovals(cmd.file);
  }
}

/** Re-applies the removal log (see the header). Exit 1 when any entry failed. */
async function replayRemovals(fileArg: string | null): Promise<number> {
  const file = fileArg ?? removalLogPath();
  if (!file) {
    console.error("No removal log for this database (REMOVAL_LOG=off or a remote DATABASE_URL). Nothing replayed.");
    return 0;
  }
  const log = await readRemovalLog(file);
  if (!log) {
    console.log(`No removal log at ${file}: nothing to replay.`);
    return 0;
  }
  if (log.skipped) console.error(`Warning: skipped ${log.skipped} malformed line(s) in ${file}.`);
  let applied = 0;
  let absent = 0;
  let failed = 0;
  for (const entry of log.entries) {
    try {
      const outcome = await replayRemoval(entry);
      if (outcome === "absent") {
        absent += 1;
        continue;
      }
      if (entry.kind === "account") await deleteAccountRows(entry.id);
      applied += 1;
    } catch (e) {
      failed += 1;
      console.error(`FAILED to re-apply ${JSON.stringify(entry)}:`, e instanceof Error ? e.message : String(e));
    }
  }
  print({ log: file, entries: log.entries.length, applied, notInThisDatabase: absent, failed });
  return failed ? 1 : 0;
}

/** The rest of an account deletion (the me route's order): entitlements,
 * then sessions, sign-in accounts and the user row. Loaded only here. */
async function deleteAccountRows(userId: string): Promise<void> {
  const { deleteUserEntitlements } = await import("../lib/entitlements");
  await deleteUserEntitlements(userId);
  const { deleteAuthUser } = await import("../lib/auth");
  await deleteAuthUser(userId);
}

function print(v: unknown) {
  console.log(JSON.stringify(v, null, 2));
}

async function main(): Promise<void> {
  const parsed = parseOriginalsArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exit(2);
  }
  process.exit(await run(parsed));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) void main();
