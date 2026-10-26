/**
 * Added context on a one-sided verdict (the ones made on the home page),
 * without HTTP. The rules are a case appeal's (lib/cases): the writer's
 * signed-in account, one premium unit per round, refunded on any failure,
 * and the whole record judged again with the one-sided appeal note. A
 * verdict takes MAX_VERDICT_APPEALS rounds, one at a time.
 *
 * A round is a verdict_appeals row and a verdict job under the same id,
 * written in one guarded batch. The job holds the reservation and the
 * state (judging, ready, failed), the job sweep fails and refunds a lost
 * run, and completeVerdictJob stores the round's verdict under that id, so
 * clients poll it like an async verdict. Nothing is overwritten: the first
 * verdict and every earlier round's verdict stay as they are.
 */

import type { Row } from "@libsql/client";
import { nanoid } from "nanoid";
import { MAX_VERDICT_APPEALS, type AppealStatus } from "@/lib/case-types";
import { composeForJudging, evidenceGroups } from "@/lib/cases/compose";
import { appealSummary, normalizeCaseResult } from "@/lib/cases/judging";
import { appealOutcome, confidenceChange } from "@/lib/cases/outcome";
import { scheduleJudging } from "@/lib/cases/schedule";
import {
  anonymizeFailure,
  labelsInUse,
  originalPayload,
  refundQuietly,
  reserveAppealUnit,
  type Blocked,
  type Failure,
} from "@/lib/cases/service";
import { withUsageMeter, type UsageTotals } from "@/lib/claude";
import { verdictLang } from "@/lib/content-lang";
import { getDb, getVerdict, type StoredVerdict } from "@/lib/db";
import { entitlementWriteBatch } from "@/lib/entitlements";
import { anonymizeSubmission, evidenceBlock, type AnonymizedSubmission, type VerifiedEvidence } from "@/lib/evidence";
import { APPEAL_ONE_SIDED_JUDGE_NOTE } from "@/lib/judge";
import { getVerdictMeta } from "@/lib/originals/db";
import type { OriginalPayload } from "@/lib/originals-types";
import { judgeAnonymized, mergeUsage, premiumLogLine, type PremiumStats } from "@/lib/premium/run";
import type { AppealInfo, AppealOutcome, NameMapping, VerdictAppealView } from "@/lib/types";
import {
  completeVerdictJob,
  ensureVerdictJobTables,
  failVerdictJob,
  jobInsertStatement,
  judgingGuard,
  maybeSweepVerdictJobs,
} from "@/lib/verdict-jobs";

export type VerdictAppealRow = {
  id: string;
  verdictId: string;
  /** Anonymized, as the judges read it. */
  text: string;
  /** Anonymized transcripts of the attached screenshot. */
  evidence: VerifiedEvidence[];
  baseId: string;
  outcome: AppealOutcome | null;
  status: AppealStatus;
  error: "quota" | "unavailable" | "refused" | null;
  reservationId: string | null;
  createdAt: string;
};

const SELECT = `SELECT a.id, a.verdict_id, a.text, a.evidence, a.base_id, a.outcome, a.created_at,
                  j.status, j.error_code, j.reservation_id
                FROM verdict_appeals a JOIN verdict_jobs j ON j.id = a.id`;

function parseEvidence(raw: unknown): VerifiedEvidence[] {
  try {
    const list: unknown = JSON.parse(String(raw));
    return Array.isArray(list) ? (list as VerifiedEvidence[]) : [];
  } catch {
    return [];
  }
}

function mapRow(r: Row): VerdictAppealRow {
  const status = String(r.status);
  return {
    id: String(r.id),
    verdictId: String(r.verdict_id),
    text: String(r.text),
    evidence: parseEvidence(r.evidence),
    baseId: String(r.base_id),
    outcome: r.outcome == null ? null : (String(r.outcome) as AppealOutcome),
    status: status === "ready" ? "judged" : status === "failed" ? "failed" : "judging",
    error: r.error_code == null ? null : (String(r.error_code) as VerdictAppealRow["error"]),
    reservationId: r.reservation_id == null ? null : String(r.reservation_id),
    createdAt: String(r.created_at),
  };
}

async function appealsDb() {
  await ensureVerdictJobTables();
  return getDb();
}

/** A verdict's rounds, oldest first. */
export async function listVerdictAppeals(verdictId: string): Promise<VerdictAppealRow[]> {
  const db = await appealsDb();
  const rs = await db.execute({ sql: `${SELECT} WHERE a.verdict_id = ? ORDER BY a.created_at, a.id`, args: [verdictId] });
  return rs.rows.map(mapRow);
}

/** The verdict a round's verdict belongs to; null for any other id. */
export async function appealRootOf(id: string): Promise<string | null> {
  const db = await appealsDb();
  const rs = await db.execute({ sql: "SELECT verdict_id FROM verdict_appeals WHERE id = ?", args: [id] });
  return rs.rows[0] ? String(rs.rows[0].verdict_id) : null;
}

/** The round an Idempotency-Key already started: still judging, or judged
 * (a degraded panel is judged and refunded). A failed round is not one. */
async function appealByKey(userId: string, usageKey: string): Promise<VerdictAppealRow | null> {
  const db = await appealsDb();
  const rs = await db.execute({
    sql: `${SELECT} JOIN premium_usage p ON p.id = j.reservation_id
          WHERE p.user_id = ? AND p.idempotency_key = ? AND (p.status <> 'refunded' OR j.status = 'ready')`,
    args: [userId, usageKey],
  });
  return rs.rows[0] ? mapRow(rs.rows[0]) : null;
}

export function appealView(a: VerdictAppealRow, writer: boolean): VerdictAppealView {
  return {
    id: a.id,
    status: a.status,
    error: a.error,
    outcome: a.outcome,
    baseId: a.baseId,
    createdAt: a.createdAt,
    ...(writer ? { text: a.text } : {}),
  };
}

/** What the rounds alone say about another one (null: nothing stops it). */
export function roundsBlock(appeals: readonly VerdictAppealRow[]): "busy" | "appeal_limit" | null {
  if (appeals.some((a) => a.status === "judging")) return "busy";
  return appeals.filter((a) => a.status === "judged").length >= MAX_VERDICT_APPEALS ? "appeal_limit" : null;
}

const EVIDENCE_MARK = "\n\nEVIDENCE (machine transcripts";

/** A stored one-sided input: the account the judges read, and the EVIDENCE
 * block premium appends when screenshots were attached. That block is always
 * last, and only there when evidence was used: the same heading typed into
 * the account stays part of the account. */
export function splitStoredInput(v: Pick<StoredVerdict, "input" | "result">): { account: string; evidence: string | null } {
  const at = (v.result.evidence_used?.a ?? 0) > 0 ? v.input.lastIndexOf(EVIDENCE_MARK) : -1;
  return at < 0 ? { account: v.input, evidence: null } : { account: v.input.slice(0, at), evidence: v.input.slice(at + 2) };
}

const contextOf = (a: VerdictAppealRow) => ({ id: a.id, party: "a" as const, text: a.text });

/** The rounds' screenshots as case evidence rows, for evidenceGroups. */
const evidenceRows = (rounds: readonly VerdictAppealRow[]) =>
  rounds.flatMap((a) =>
    a.evidence.map((e, i) => ({
      id: `${a.id}:${i + 1}`,
      party: "a" as const,
      appealId: a.id,
      seq: i + 1,
      kind: e.kind,
      transcript: e.transcript,
    })),
  );

// --- Submit ---------------------------------------------------------------------

export type VerdictAppealInput = {
  verdictId: string;
  userId: string;
  text: string;
  /** The context exactly as received (before trimming), for the sealed original. */
  rawText?: string;
  evidence: VerifiedEvidence[];
  idempotencyKey?: string;
  now?: Date;
};

export type VerdictAppealResult =
  | { ok: true; appeal: VerdictAppealRow; nameMap: NameMapping[]; replayed: boolean }
  | Blocked
  | Failure<"not_found" | "removed" | "appeal_limit" | "in_progress" | "unavailable" | "anonymize_failed">;

/** The verdict is this account's own one-sided verdict and still up. */
const OWNED_SQL = `EXISTS (SELECT 1 FROM verdict_meta WHERE verdict_id = ? AND owner_user_id = ?
  AND kind IN ('free','premium') AND removed_at IS NULL)`;
const JUDGED_SQL = "verdict_appeals x JOIN verdicts xv ON xv.id = x.id WHERE x.verdict_id = ?";

function logError(what: string, e: unknown): void {
  console.error(`[verdict-appeals] ${what}:`, e instanceof Error ? e.message : String(e));
}

/** Why a round that lost its write did not start. */
async function lostReason(verdictId: string, userId: string): Promise<VerdictAppealResult> {
  const meta = await getVerdictMeta(verdictId);
  if (!meta || meta.ownerUserId !== userId) return { ok: false, code: "not_found" };
  if (meta.removedAt) return { ok: false, code: "removed" };
  const block = roundsBlock(await listVerdictAppeals(verdictId));
  if (block) return { ok: false, code: block === "busy" ? "in_progress" : "appeal_limit" };
  return { ok: false, code: "unavailable" };
}

/** Starts a round: the caller has checked that `userId` owns the verdict. */
export async function submitVerdictAppeal(input: VerdictAppealInput): Promise<VerdictAppealResult> {
  const startedAt = Date.now();
  const now = input.now ?? new Date();
  const { verdictId, userId } = input;
  await maybeSweepVerdictJobs(now);
  const usageKey = input.idempotencyKey ? `appeal:v:${verdictId}:${input.idempotencyKey}` : undefined;
  if (usageKey) {
    const prior = await appealByKey(userId, usageKey);
    if (prior) return { ok: true, appeal: prior, nameMap: [], replayed: true };
  }

  const stored = await getVerdict(verdictId);
  if (!stored) return { ok: false, code: "not_found" };
  const appeals = await listVerdictAppeals(verdictId);
  const block = roundsBlock(appeals);
  if (block) return { ok: false, code: block === "busy" ? "in_progress" : "appeal_limit" };

  const unit = await reserveAppealUnit(userId, usageKey, now);
  if ("replayed" in unit) {
    const prior = usageKey ? await appealByKey(userId, usageKey) : null;
    return prior ? { ok: true, appeal: prior, nameMap: [], replayed: true } : { ok: false, code: "in_progress" };
  }
  if (!("reservationId" in unit)) return unit;
  const { reservationId } = unit;

  const judged = appeals.filter((a) => a.status === "judged");
  const { account, evidence: baseEvidence } = splitStoredInput(stored);
  const context = [
    composeForJudging([{ party: "a", text: account }], "one_sided", { earlier: judged.map(contextOf), current: null }),
    baseEvidence,
    ...judged.flatMap((a) => a.evidence.map((e) => e.transcript)),
  ]
    .filter(Boolean)
    .join("\n\n");
  let sub: AnonymizedSubmission;
  let anonymizeUsage: UsageTotals;
  try {
    ({ value: sub, usage: anonymizeUsage } = await withUsageMeter(() =>
      anonymizeSubmission({
        narrator: "Party A",
        text: input.text,
        evidence: input.evidence,
        lang: verdictLang(stored.result),
        roster: { context, labelsInUse: labelsInUse(context, []) },
      }),
    ));
  } catch (e) {
    logError("anonymizing the context failed", e);
    await refundQuietly(reservationId);
    return { ok: false, code: anonymizeFailure(e) };
  }

  const id = nanoid(10);
  const nowIso = now.toISOString();
  let won = false;
  try {
    const rs = await entitlementWriteBatch([
      {
        // The verdict this round answers is read here: the latest judged round's, else the first.
        sql: `INSERT INTO verdict_appeals (id, verdict_id, text, evidence, base_id, outcome, created_at, updated_at)
              SELECT ?, ?, ?, ?,
                     COALESCE((SELECT x.id FROM ${JUDGED_SQL} ORDER BY x.created_at DESC, x.id DESC LIMIT 1), ?),
                     NULL, ?, ?
              WHERE ${OWNED_SQL}
                AND NOT EXISTS (SELECT 1 FROM verdict_appeals x JOIN verdict_jobs xj ON xj.id = x.id
                                WHERE x.verdict_id = ? AND xj.status = 'judging')
                AND (SELECT COUNT(*) FROM ${JUDGED_SQL}) < ?`,
        args: [
          id,
          verdictId,
          sub.text,
          JSON.stringify(sub.evidence),
          verdictId,
          verdictId,
          nowIso,
          nowIso,
          verdictId,
          userId,
          verdictId,
          verdictId,
          MAX_VERDICT_APPEALS,
        ],
      },
      jobInsertStatement({ id, kind: "premium", reservationId, ownerUserId: userId }, nowIso, {
        sql: "EXISTS (SELECT 1 FROM verdict_appeals WHERE id = ?)",
        args: [id],
      }),
    ]);
    won = rs[0].rowsAffected === 1;
  } catch (e) {
    logError("storing the context failed", e);
    await refundQuietly(reservationId);
    return { ok: false, code: "unavailable" };
  }
  if (!won) {
    await refundQuietly(reservationId);
    return lostReason(verdictId, userId);
  }

  const original = originalPayload(input.rawText ?? input.text, input.evidence, sub);
  scheduleJudging(() => runVerdictAppeal({ id, verdictId, userId, reservationId, original, startedAt, anonymizeUsage }));
  const appeal = (await listVerdictAppeals(verdictId)).find((a) => a.id === id);
  if (!appeal) return { ok: false, code: "unavailable" };
  return { ok: true, appeal, nameMap: sub.nameMap, replayed: false };
}

// --- Judging ----------------------------------------------------------------------

export type VerdictAppealRun = {
  id: string;
  verdictId: string;
  userId: string;
  reservationId: string;
  /** The context as written, sealed with the round's verdict. */
  original: OriginalPayload;
  startedAt: number;
  anonymizeUsage?: UsageTotals;
};

/**
 * Judges one round in the background: the first account, every earlier
 * round, then this one. A refusal fails the round (a refused card would
 * replace a real ruling); a degraded panel stores the verdict and refunds.
 * Never throws: every failure ends as a failed, refunded job.
 */
export async function runVerdictAppeal(p: VerdictAppealRun): Promise<void> {
  const stats: PremiumStats = { factCheck: "unavailable", claims: 0, escalated: false, trial: false, ms: 0 };
  let usage: UsageTotals = p.anonymizeUsage ?? { calls: 0, input: 0, output: 0, searches: 0, byModel: {} };
  const log = (id: string | null, outcome: string) =>
    console.info(`${premiumLogLine(id, outcome, { usage, stats })} appeal_of=${p.verdictId}`);
  const fail = (code: "quota" | "unavailable" | "refused") => failVerdictJob(p.id, code, p.reservationId);
  try {
    const appeals = await listVerdictAppeals(p.verdictId);
    const current = appeals.find((a) => a.id === p.id);
    if (!current || current.status !== "judging") return;
    const [root, base] = await Promise.all([getVerdict(p.verdictId), getVerdict(current.baseId)]);
    if (!root || !base) {
      await fail("unavailable");
      return;
    }
    const earlier = appeals.filter((a) => a.status === "judged");
    const rounds = { earlier: earlier.map(contextOf), current: contextOf(current) };
    const { account, evidence: baseEvidence } = splitStoredInput(root);
    const document = composeForJudging([{ party: "a", text: account }], "one_sided", rounds);
    const added = evidenceBlock(evidenceGroups(evidenceRows([...earlier, current]), "one_sided", rounds));
    const evText = [baseEvidence, added].filter(Boolean).join("\n\n") || null;
    const lang = verdictLang(root.result);

    const judgingFrom = Date.now();
    const run = await withUsageMeter(() =>
      judgeAnonymized(
        {
          text: document,
          context: evText,
          framework: root.framework,
          lang,
          ...(evText ? { evidence: true } : {}),
          appeal: APPEAL_ONE_SIDED_JUDGE_NOTE,
        },
        { startedAt: p.startedAt, stats },
      ),
    );
    stats.ms = Date.now() - judgingFrom;
    usage = mergeUsage(usage, run.usage);
    const outcome = run.value;
    if (outcome.status === "failed") {
      console.error(`[verdict-appeals] ${p.id}: judging failed:`, outcome.error);
      log(null, `appeal_${outcome.code}`);
      await fail(outcome.code);
      return;
    }
    if (outcome.refused) {
      log(null, "appeal_refused");
      await fail("refused");
      return;
    }

    const images = (root.result.evidence_used?.a ?? 0) + [...earlier, current].reduce((n, a) => n + a.evidence.length, 0);
    const next = normalizeCaseResult(outcome.result, { twoSided: false, evidenceUsed: { a: images, b: 0 } });
    const label = appealOutcome(base.result, next);
    const summary = await withUsageMeter(() => appealSummary(base.result, next, { party: "a", text: current.text }, lang, label));
    usage = mergeUsage(usage, summary.usage);
    const info: AppealInfo = {
      by: "a",
      outcome: label,
      previous_id: current.baseId,
      previous_verdict: base.result.verdict,
      previous_confidence: base.result.confidence,
      confidence_change: confidenceChange(base.result, next),
      summary: summary.value,
    };

    const guard = judgingGuard(p.id);
    const at = new Date().toISOString();
    const done = await completeVerdictJob(
      {
        id: p.id,
        input: evText ? `${document}\n\n${evText}` : document,
        framework: root.framework,
        result: { ...next, appeal: info },
        kind: "premium",
        ownerUserId: p.userId,
        original: p.original,
      },
      {
        ownerToken: null,
        reservationId: p.reservationId,
        settle: outcome.degraded ? "refund" : "consume",
        extra: [
          {
            sql: `UPDATE verdict_appeals SET outcome = ?, updated_at = ? WHERE id = ? AND ${guard.sql}`,
            args: [label, at, p.id, ...guard.args],
          },
          // The first verdict was removed while this was judged: its new verdict is closed too.
          {
            sql: `UPDATE verdict_meta SET
                    removed_at = (SELECT r.removed_at FROM verdict_meta r WHERE r.verdict_id = ?),
                    removal_reason = (SELECT r.removal_reason FROM verdict_meta r WHERE r.verdict_id = ?),
                    display_sealed = NULL, display_key_id = NULL, names_visible = 0
                  WHERE verdict_id = ? AND ${guard.sql}
                    AND EXISTS (SELECT 1 FROM verdict_meta r WHERE r.verdict_id = ? AND r.removed_at IS NOT NULL)`,
            args: [p.verdictId, p.verdictId, p.id, ...guard.args, p.verdictId],
          },
          {
            sql: `UPDATE originals SET sealed = NULL, key_id = NULL, removed_at = ?
                  WHERE verdict_id = ? AND ${guard.sql}
                    AND EXISTS (SELECT 1 FROM verdict_meta WHERE verdict_id = ? AND removed_at IS NOT NULL)`,
            args: [at, p.id, ...guard.args, p.verdictId],
          },
        ],
      },
    );
    if (!done.stored) {
      log(null, "appeal_superseded");
      return;
    }
    log(p.id, outcome.degraded ? "appeal_degraded" : `appeal_${label}`);
  } catch (e) {
    logError(`${p.id} failed`, e);
    log(null, "appeal_error");
    await fail("unavailable").catch((err: unknown) => logError(`${p.id}: marking failed did not work`, err));
  }
}

/** The verdicts a verdict's judged rounds produced, oldest first. */
export async function appealVerdicts(verdictId: string): Promise<StoredVerdict[]> {
  const judged = (await listVerdictAppeals(verdictId)).filter((a) => a.status === "judged");
  const stored = await Promise.all(judged.map((a) => getVerdict(a.id)));
  return stored.filter((v): v is StoredVerdict => v !== null);
}
