/**
 * The 30-day wipe. Removal blanks originals and names at once; 30 days
 * later this also blanks the anonymized text the judges read and the verdict
 * text, keeping the outcome (verdict, confidence, winner, votes, evidence
 * counts and the other numbers and enums) and the dates, and stamps
 * `erased_at`. No row is deleted.
 *
 * - A one-sided verdict (and the verdicts of its rounds of added context):
 *   30 days after it was removed.
 * - A case: 30 days after the last party removed it, so a party that still
 *   sees it keeps it whole. The parties are the owner and every side that
 *   wrote an account.
 * - `legal_hold = 1` on a verdict or a case (set by hand in SQL, no API)
 *   keeps it out of the wipe; so does one held verdict of a case.
 *
 * Runs at startup and then daily. Server only.
 */

import type { InStatement } from "@libsql/client";
import { getDb } from "@/lib/db";
import { entitlementWriteBatch } from "@/lib/entitlements";
import { ensureOriginalsTables } from "@/lib/originals/db";

const DAY_MS = 24 * 60 * 60_000;
export const ERASE_AFTER_MS = 30 * DAY_MS;
const BATCH_LIMIT = 100;

/** Strings in a stored result that are enums or ids, not text. */
const KEEP_KEYS = new Set([
  "verdict",
  "previous_verdict",
  "dispute_type",
  "kind",
  "lang",
  "tier",
  "party",
  "by",
  "finding",
  "outcome",
  "status",
  "winner",
  "runs",
  "votes",
  "parties",
  "models",
  "previous_id",
]);

function blank(value: unknown, key: string): unknown {
  if (typeof value === "string") return KEEP_KEYS.has(key) ? value : "";
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string") && !KEEP_KEYS.has(key)) return [];
    return value.map((v) => blank(v, key));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, blank(v, k)]));
  }
  return value;
}

/** A stored result (or translation) without its text, still shaped like one.
 * Unreadable JSON becomes an empty object. */
export function blankResult(json: string): string {
  try {
    return JSON.stringify(blank(JSON.parse(json), ""));
  } catch {
    return "{}";
  }
}

/** The statements that erase these verdicts' text (and their translations). */
async function eraseVerdictStatements(ids: string[], nowIso: string): Promise<InStatement[]> {
  const db = await getDb();
  const marks = ids.map(() => "?").join(", ");
  const [verdicts, translations] = await Promise.all([
    db.execute({ sql: `SELECT id, result FROM verdicts WHERE id IN (${marks}) AND erased_at IS NULL AND legal_hold = 0`, args: ids }),
    db.execute({ sql: `SELECT id, lang, result_json FROM verdict_translations WHERE id IN (${marks})`, args: ids }),
  ]);
  const erasable = new Set(verdicts.rows.map((r) => String(r.id)));
  return [
    ...verdicts.rows.map((r) => ({
      sql: "UPDATE verdicts SET input = '', result = ?, erased_at = ? WHERE id = ? AND erased_at IS NULL AND legal_hold = 0",
      args: [blankResult(String(r.result)), nowIso, String(r.id)],
    })),
    ...translations.rows
      .filter((r) => erasable.has(String(r.id)))
      .map((r) => ({
        sql: "UPDATE verdict_translations SET result_json = ? WHERE id = ? AND lang = ?",
        args: [blankResult(String(r.result_json)), String(r.id), String(r.lang)],
      })),
  ];
}

/** One-sided verdicts removed before `cutoff`, with the verdicts of their
 * rounds (which follow the first verdict's removal). Case verdicts are
 * erased with their case. */
async function eraseVerdicts(cutoff: string, nowIso: string): Promise<number> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT v.id FROM verdicts v
          LEFT JOIN verdict_meta m ON m.verdict_id = v.id
          LEFT JOIN verdict_appeals ap ON ap.id = v.id
          LEFT JOIN verdict_meta rm ON rm.verdict_id = ap.verdict_id
          LEFT JOIN verdicts rv ON rv.id = ap.verdict_id
          WHERE v.erased_at IS NULL AND v.legal_hold = 0 AND COALESCE(rv.legal_hold, 0) = 0
            AND COALESCE(m.kind, '') <> 'case'
            AND COALESCE(rm.removed_at, m.removed_at) < ?
          LIMIT ?`,
    args: [cutoff, BATCH_LIMIT],
  });
  const ids = rs.rows.map((r) => String(r.id));
  if (ids.length === 0) return 0;
  const marks = ids.map(() => "?").join(", ");
  await entitlementWriteBatch([
    ...(await eraseVerdictStatements(ids, nowIso)),
    {
      sql: `UPDATE verdict_appeals SET text = '', evidence = '[]', updated_at = ? WHERE id IN (${marks})`,
      args: [nowIso, ...ids],
    },
  ]);
  return ids.length;
}

/** Cases every party removed, the last of them before `cutoff`. */
async function eraseCases(cutoff: string, nowIso: string): Promise<number> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT c.id FROM cases c
          WHERE c.erased_at IS NULL AND c.legal_hold = 0 AND c.removed_a_at IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM case_sides s WHERE s.case_id = c.id AND CASE s.party
                WHEN 'a' THEN c.removed_a_at WHEN 'b' THEN c.removed_b_at WHEN 'c' THEN c.removed_c_at ELSE c.removed_d_at END IS NULL)
            AND NOT EXISTS (
              SELECT 1 FROM case_verdicts cv JOIN verdicts v ON v.id = cv.verdict_id WHERE cv.case_id = c.id AND v.legal_hold = 1)
            AND MAX(c.removed_a_at, COALESCE(c.removed_b_at, ''), COALESCE(c.removed_c_at, ''), COALESCE(c.removed_d_at, '')) < ?
          LIMIT ?`,
    args: [cutoff, BATCH_LIMIT],
  });
  for (const row of rs.rows) {
    const id = String(row.id);
    const verdicts = await db.execute({ sql: "SELECT verdict_id FROM case_verdicts WHERE case_id = ?", args: [id] });
    const verdictIds = verdicts.rows.map((r) => String(r.verdict_id));
    await entitlementWriteBatch([
      ...(verdictIds.length > 0 ? await eraseVerdictStatements(verdictIds, nowIso) : []),
      { sql: "UPDATE case_sides SET text = '' WHERE case_id = ?", args: [id] },
      { sql: "UPDATE case_appeals SET text = '' WHERE case_id = ?", args: [id] },
      { sql: "UPDATE case_evidence SET transcript = '' WHERE case_id = ?", args: [id] },
      { sql: "UPDATE cases SET erased_at = ? WHERE id = ? AND erased_at IS NULL", args: [nowIso, id] },
    ]);
  }
  return rs.rows.length;
}

/** Erases everything whose 30 days are up. Returns how many verdicts and
 * cases it erased. */
export async function sweepErasures(now: Date = new Date()): Promise<{ verdicts: number; cases: number }> {
  await ensureOriginalsTables();
  const cutoff = new Date(now.getTime() - ERASE_AFTER_MS).toISOString();
  const nowIso = now.toISOString();
  const total = { verdicts: 0, cases: 0 };
  for (let n = BATCH_LIMIT; n === BATCH_LIMIT; ) {
    n = await eraseVerdicts(cutoff, nowIso);
    total.verdicts += n;
  }
  for (let n = BATCH_LIMIT; n === BATCH_LIMIT; ) {
    n = await eraseCases(cutoff, nowIso);
    total.cases += n;
  }
  return total;
}

const globalForErasure = globalThis as unknown as { __judgeErasureSweeper?: boolean };

async function sweepQuietly(): Promise<void> {
  try {
    const n = await sweepErasures();
    if (n.verdicts || n.cases) console.info(`[erasure] erased ${n.verdicts} verdicts and ${n.cases} cases removed over 30 days ago`);
  } catch (e) {
    console.error("[erasure] sweep failed:", e instanceof Error ? e.message : String(e));
  }
}

/** Server startup: sweep now, then once a day. Once per process. */
export function startErasureSweeper(): void {
  if (globalForErasure.__judgeErasureSweeper) return;
  globalForErasure.__judgeErasureSweeper = true;
  void sweepQuietly();
  const timer = setInterval(() => void sweepQuietly(), DAY_MS);
  timer.unref?.();
}
