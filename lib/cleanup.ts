/**
 * Daily clean-up beside the erasure sweep (lib/erasure): expired sign-in
 * code rows, consent ledger rows six years after their account was deleted,
 * signed-out answer ticks (case_side_attest) after six years, removal-log
 * entries older than 90 days, and accounts whose final under-13 block is 7
 * days old (lib/minor-deletion), accounts that waited 30 days for a parent,
 * and parent consent records 12 months after their account went
 * (lib/parent-consent), and device claims for the free verdict older than
 * two days. Runs at startup and then
 * daily; a step that fails is logged and the others still run. (Name
 * fingerprints are blanked with the case in lib/erasure, usage events and
 * old device links in lib/analytics/db.) Server only.
 */

import { clearAdultDobs } from "@/lib/age";
import { getDb } from "@/lib/db";
import { pruneFreeDeviceClaims } from "@/lib/entitlements";
import { ensureCaseTables } from "@/lib/cases/db";
import { ensureFeedbackTables } from "@/lib/feedback/db";
import { deleteBlockedAccounts, deleteParentAccounts } from "@/lib/minor-deletion";
import { pruneParentRecords } from "@/lib/parent-consent";
import { pruneRemovalLog } from "@/lib/originals/removal-log";

const DAY_MS = 24 * 60 * 60_000;

/** Better Auth only deletes an expired code when the same address signs in
 * again, so the rest would stay with the address in them. The typeof check
 * keeps a row whose date was ever stored as a number. */
async function purgeVerification(nowIso: string): Promise<number> {
  const db = await getDb();
  try {
    const rs = await db.execute({
      sql: "DELETE FROM verification WHERE typeof(expiresAt) = 'text' AND expiresAt < ?",
      args: [nowIso],
    });
    return rs.rowsAffected;
  } catch (e) {
    // A database nobody has signed in to yet has no such table.
    if (/no such table/i.test(e instanceof Error ? e.message : String(e))) return 0;
    throw e;
  }
}

/** Ledger rows whose account was deleted at least six years ago (the table's
 * trigger refuses any other delete). */
async function pruneLedger(): Promise<number> {
  await ensureFeedbackTables();
  const db = await getDb();
  // The cutoff comes from the database clock, the one the delete trigger checks.
  const rs = await db.execute({
    sql: "DELETE FROM consent_ledger WHERE unlinked_at IS NOT NULL AND unlinked_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 years')",
    args: [],
  });
  return rs.rowsAffected;
}

/** The ticks a signed-out writer gave with their answer, six years after they were given.
 * They are also deleted with their case (lib/erasure). */
async function pruneAttests(now: Date): Promise<number> {
  await ensureCaseTables();
  const db = await getDb();
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 6);
  const rs = await db.execute({
    sql: "DELETE FROM case_side_attest WHERE MAX(adult_confirmed_at, sensitive_agreed_at) < ?",
    args: [cutoff.toISOString()],
  });
  return rs.rowsAffected;
}

export type CleanupCounts = {
  verification: number;
  ledger: number;
  removalLog: number;
  adultDobs: number;
  attests: number;
  blocked: number;
  parentless: number;
  parentRecords: number;
  deviceClaims: number;
};

export async function runCleanup(now: Date = new Date()): Promise<CleanupCounts> {
  const counts: CleanupCounts = { verification: 0, ledger: 0, removalLog: 0, adultDobs: 0, attests: 0, blocked: 0, parentless: 0, parentRecords: 0, deviceClaims: 0 };
  const steps: [keyof CleanupCounts, () => Promise<number>][] = [
    ["verification", () => purgeVerification(now.toISOString())],
    ["ledger", () => pruneLedger()],
    ["removalLog", () => pruneRemovalLog(now)],
    ["adultDobs", () => clearAdultDobs()],
    ["attests", () => pruneAttests(now)],
    ["blocked", () => deleteBlockedAccounts(now)],
    ["parentless", () => deleteParentAccounts(now)],
    ["parentRecords", () => pruneParentRecords(now)],
    ["deviceClaims", () => pruneFreeDeviceClaims(now)],
  ];
  for (const [name, step] of steps) {
    try {
      counts[name] = await step();
    } catch (e) {
      console.error(`[cleanup] ${name} failed:`, e instanceof Error ? e.message : String(e));
    }
  }
  return counts;
}

const globalForCleanup = globalThis as unknown as { __judgeCleanup?: boolean };

async function cleanQuietly(): Promise<void> {
  const n = await runCleanup();
  if (n.verification || n.ledger || n.removalLog || n.adultDobs || n.attests || n.blocked || n.parentless || n.parentRecords || n.deviceClaims) {
    console.info(
      `[cleanup] dropped ${n.verification} expired sign-in codes, ${n.ledger} old consent records, ${n.removalLog} old removal-log entries, ${n.attests} old answer ticks and ${n.adultDobs} dates of birth of people who turned 18; deleted ${n.blocked} blocked accounts and ${n.parentless} accounts no parent said yes for, dropped ${n.parentRecords} old parent consent records and ${n.deviceClaims} old device claims`,
    );
  }
}

/** Server startup: clean now, then once a day. Once per process. */
export function startCleanup(): void {
  if (globalForCleanup.__judgeCleanup) return;
  globalForCleanup.__judgeCleanup = true;
  void cleanQuietly();
  const timer = setInterval(() => void cleanQuietly(), DAY_MS);
  timer.unref?.();
}
