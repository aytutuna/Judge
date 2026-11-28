import { deleteUserEntitlements } from "@/lib/entitlements";
import { deleteAuthUser } from "@/lib/auth";
import { replayRemoval } from "./removal";
import type { RemovalLogEntry } from "./removal-log";

export type ReplayReport = { entries: number; applied: number; notInThisDatabase: number; failed: number };

/** Re-applies removals after a database restore. Accounts also lose the rest
 * of their rows (the me route's order: entitlements, then sessions, sign-in
 * accounts and the user row). Never throws; failures are logged and counted. */
export async function replayEntries(entries: readonly RemovalLogEntry[]): Promise<ReplayReport> {
  const report: ReplayReport = { entries: entries.length, applied: 0, notInThisDatabase: 0, failed: 0 };
  for (const entry of entries) {
    try {
      if ((await replayRemoval(entry)) === "absent") {
        report.notInThisDatabase += 1;
        continue;
      }
      if (entry.kind === "account") {
        await deleteUserEntitlements(entry.id);
        await deleteAuthUser(entry.id);
      }
      report.applied += 1;
    } catch (e) {
      report.failed += 1;
      console.error(`FAILED to re-apply ${JSON.stringify(entry)}:`, e instanceof Error ? e.message : String(e));
    }
  }
  return report;
}
