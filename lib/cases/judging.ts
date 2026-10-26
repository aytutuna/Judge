/**
 * Background judging for cases and appeals (scheduled after the response).
 * Each run is identified by a fresh token stored with the case
 * (judging_token) or the appeal (attempt_token); every write of the run is
 * guarded by it, so a run the sweep already failed changes nothing: the
 * verdict row itself is inserted in the same guarded batch, so a superseded
 * run writes no row at all (verdict rows are never deleted). Each case
 * verdict gets its ownership row (verdict_meta, kind 'case') in that batch,
 * already removed if the case was. A stored verdict consumes the unit exactly once; a
 * failure refunds it; a refused or degraded panel shows the verdict but
 * refunds (rules of lib/premium/handler.ts). A free case's first verdict
 * comes from the free judges and touches no unit; appeals are premium on
 * every case. Never throws.
 */

import { nanoid } from "nanoid";
import type { CaseMode } from "@/lib/case-types";
import { claudeJson, LITE_MODEL, withUsageMeter, type UsageTotals } from "@/lib/claude";
import { judgeFreeAnonymized } from "@/lib/free-run";
import type { InStatement } from "@libsql/client";
import { consumeStatement, entitlementWriteBatch, refundStatements, type StatementGuard } from "@/lib/entitlements";
import { CASE_REMOVAL_REASON_SQL, ensureOriginalsTables } from "@/lib/originals/db";
import { evidenceBlock } from "@/lib/evidence";
import type { Lang } from "@/lib/i18n";
import { APPEAL_JUDGE_NOTE, APPEAL_ONE_SIDED_JUDGE_NOTE } from "@/lib/judge";
import { judgeAnonymized, premiumLogLine, type JudgedOutcome, type PremiumStats } from "@/lib/premium/run";
import type { AppealInfo, AppealOutcome, DisputedFact, EvidenceUsed, FrameworkChoice, VerdictResult } from "@/lib/types";
import { composeForJudging, evidenceCounts, evidenceGroups } from "./compose";
import { getCase, loadCaseBundle, type AppealRow, type CaseBundle } from "./db";
import { notifyOwnerCaseReady } from "./notify";
import { appealOutcome, confidenceChange } from "./outcome";
import { failAppealStatements, failJudgingStatements } from "./sweep";

const MAX_AGREED = 5;
const MAX_DISPUTED = 4;
const MAX_WOULD_CHANGE = 3;
const MAX_ITEM_CHARS = 300;
const SUMMARY_TIMEOUT_MS = 30_000;

const clip = (s: string) => {
  const t = s.trim();
  return t.length > MAX_ITEM_CHARS ? `${t.slice(0, MAX_ITEM_CHARS - 1).trimEnd()}…` : t;
};

/**
 * The stored shape of a case verdict. Two-sided: agreed_facts <= 5,
 * disputed_facts <= 4 with at most one decisive, would_change <= 3, every
 * string clipped, missing arrays -> [], two_sided: true and evidence_used.
 * When the crux trial overturned the ruling, the decisive dispute reads
 * "unsettled": the card must not call the fact the ruling hinges on settled
 * right under "the ruling didn't hold up".
 * One-sided: no two-sided fields; evidence_used only when images were used.
 */
export function normalizeCaseResult(
  result: VerdictResult,
  opts: { twoSided: boolean; evidenceUsed: EvidenceUsed },
): VerdictResult {
  const {
    two_sided: _t,
    agreed_facts: agreed,
    disputed_facts: disputed,
    would_change: would,
    evidence_used: _e,
    ...rest
  } = result;
  void _t;
  void _e;
  const used = opts.evidenceUsed.a + opts.evidenceUsed.b > 0;
  if (!opts.twoSided) return { ...rest, ...(used ? { evidence_used: opts.evidenceUsed } : {}) };
  let decisiveSeen = false;
  const overturned = rest.crux_trial?.outcome === "overturned";
  const disputedFacts: DisputedFact[] = (disputed ?? []).slice(0, MAX_DISPUTED).map((d) => {
    const decisive = d.decisive && !decisiveSeen;
    if (decisive) decisiveSeen = true;
    const finding = decisive && overturned ? "unsettled" : d.finding;
    return { fact: clip(d.fact), party_a: clip(d.party_a), party_b: clip(d.party_b), finding, decisive };
  });
  return {
    ...rest,
    two_sided: true,
    agreed_facts: (agreed ?? []).map(clip).filter(Boolean).slice(0, MAX_AGREED),
    disputed_facts: disputedFacts,
    would_change: (would ?? []).map(clip).filter(Boolean).slice(0, MAX_WOULD_CHANGE),
    evidence_used: opts.evidenceUsed,
  };
}

const OUTCOME_MEANING: Record<AppealOutcome, string> = {
  upheld: "upheld (the same outcome as before)",
  overturned: "overturned (the other party now wins)",
  changed: "changed (the outcome is different, but not a flip from one winner to the other)",
};

const SUMMARY_SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"],
} as const;

function summarySystem(lang: Lang): string {
  const language =
    lang === "tr"
      ? 'Write in Turkish, in everyday words, with informal "sen" if you address anyone, never "siz". Call the parties "Taraf A" and "Taraf B"; keep other labels such as "Person C" exactly as written.'
      : 'Write in plain everyday English. Call the parties "Party A" and "Party B"; keep other labels such as "Person C" exactly as written.';
  return `You write one sentence for an argument-settling app. A case was judged, then one party added new context and the whole case was judged again. The app already shows the outcome label and both confidence scores, so never repeat numbers and never contradict the label. Say what the new context changed in the judges' reasoning, or why it did not change the outcome. One short sentence of 12 to 25 words: name the one point that mattered, nothing more. No names, no quotes, no preamble. ${language}`;
}

/** One sentence on what the new context changed. Fails open to "". */
export async function appealSummary(
  prev: VerdictResult,
  next: VerdictResult,
  appeal: { party: "a" | "b"; text: string },
  lang: Lang,
  outcome: AppealOutcome,
): Promise<string> {
  try {
    const user = [
      `OUTCOME LABEL: ${OUTCOME_MEANING[outcome]}`,
      "",
      `EARLIER VERDICT: ${prev.verdict} (confidence ${prev.confidence}/5)`,
      `Headline: ${prev.headline}`,
      `Crux: ${prev.crux}`,
      "",
      `NEW VERDICT: ${next.verdict} (confidence ${next.confidence}/5)`,
      `Headline: ${next.headline}`,
      `Crux: ${next.crux}`,
      "",
      `NEW CONTEXT FROM PARTY ${appeal.party.toUpperCase()}:`,
      appeal.text,
    ].join("\n");
    const res = await claudeJson<{ summary?: unknown }>({
      system: summarySystem(lang),
      user,
      schema: SUMMARY_SCHEMA,
      effort: "low",
      model: LITE_MODEL,
      timeoutMs: SUMMARY_TIMEOUT_MS,
    });
    if (!res.ok || typeof res.data.summary !== "string") return "";
    return clip(res.data.summary);
  } catch {
    return "";
  }
}

/** One `[cases] usage` log line: the model calls of a case step outside the
 * judging run (anonymizing a submission, the appeal summary). Counts only. */
export function casesUsageLine(caseId: string, step: string, usage: UsageTotals, ms: number, outcome = "ok"): string {
  const byModel = Object.entries(usage.byModel)
    .map(([model, m]) => `${model}:${m.calls}x/${m.input}in/${m.output}out`)
    .join(",");
  return [
    "[cases] usage",
    `case=${caseId}`,
    `step=${step}`,
    `outcome=${outcome}`,
    `ms=${ms}`,
    `calls=${usage.calls}`,
    `in=${usage.input}`,
    `out=${usage.output}`,
    `total=${usage.input + usage.output}`,
    `models=${byModel || "-"}`,
  ].join(" ");
}

/** Runs `fn` under a usage meter and logs its `[cases] usage` line, success
 * or not. Rethrows what `fn` throws. */
export async function meteredStep<T>(caseId: string, step: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  const { value, usage } = await withUsageMeter(async () => {
    try {
      return { ok: true as const, v: await fn() };
    } catch (e) {
      return { ok: false as const, e };
    }
  });
  console.info(casesUsageLine(caseId, step, usage, Date.now() - startedAt, value.ok ? "ok" : "error"));
  if (!value.ok) throw value.e;
  return value.v;
}

function emptyStats(): PremiumStats {
  return { factCheck: "unavailable", claims: 0, escalated: false, trial: false, ms: 0 };
}

type Judged = { outcome: JudgedOutcome | null; error: string | null; log: (id: string | null, o: string) => void };

/** judgeAnonymized under a usage meter; an unexpected throw becomes a failure.
 * The `[premium]` line carries the case id at its end. `startedAt` is when
 * the request that scheduled the run began: anonymizing that request's
 * submission counts against the deadline gates. */
async function judge(
  caseId: string,
  input: Parameters<typeof judgeAnonymized>[0],
  startedAt: number,
): Promise<Judged> {
  const judgingFrom = Date.now();
  const stats = emptyStats();
  let usage = { calls: 0, input: 0, output: 0, searches: 0, byModel: {} } as Parameters<typeof premiumLogLine>[2]["usage"];
  let outcome: JudgedOutcome | null = null;
  let error: string | null = null;
  try {
    const metered = await withUsageMeter(() => judgeAnonymized(input, { startedAt, stats }));
    outcome = metered.value;
    usage = metered.usage;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  stats.ms = Date.now() - judgingFrom;
  return { outcome, error, log: (id, o) => console.info(`${premiumLogLine(id, o, { usage, stats })} case=${caseId}`) };
}

/** A free case's first verdict: the free judges, in the same outcome shape
 * so the caller stores it the same way. Nothing is charged, so a refusal is
 * simply stored as the refused result and there is no degraded panel. */
async function judgeFree(
  caseId: string,
  input: { text: string; framework: FrameworkChoice; lang: Lang; twoSided: boolean },
): Promise<Judged> {
  const judgingFrom = Date.now();
  let usage: UsageTotals = { calls: 0, input: 0, output: 0, searches: 0, byModel: {} };
  let outcome: JudgedOutcome | null = null;
  let error: string | null = null;
  try {
    const metered = await withUsageMeter(() =>
      judgeFreeAnonymized(input.text, input.framework, input.lang, input.twoSided ? { twoSided: true } : {}),
    );
    usage = metered.usage;
    const judged = metered.value;
    outcome = judged.ok
      ? { status: "ok", result: judged.result, input: input.text, refused: judged.result.model_refused === true, degraded: false }
      : { status: "failed", code: judged.code, error: judged.detail };
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const ms = Date.now() - judgingFrom;
  return { outcome, error, log: (id, o) => console.info(`${casesUsageLine(caseId, "judge_free", usage, ms, o)} id=${id ?? "-"}`) };
}

const verdictGuard = (verdictId: string): StatementGuard => ({
  sql: "EXISTS (SELECT 1 FROM case_verdicts WHERE verdict_id = ?)",
  args: [verdictId],
});

/** The verdict row and its ownership row, both written only when `runGuard`
 * (the run's token still current) holds. Every later statement of the batch
 * is guarded on the verdict row existing. */
function verdictRowStatements(
  verdictId: string,
  caseId: string,
  input: string,
  framework: FrameworkChoice,
  result: VerdictResult,
  runGuard: StatementGuard,
  nowIso: string,
): InStatement[] {
  return [
    {
      sql: `INSERT INTO verdicts (id, input, framework, result) SELECT ?, ?, ?, ? WHERE ${runGuard.sql}`,
      args: [verdictId, input, JSON.stringify(framework), JSON.stringify(result), ...runGuard.args],
    },
    {
      sql: `INSERT INTO verdict_meta (verdict_id, kind, case_id, names_visible, removed_at, removal_reason, created_at, updated_at)
            SELECT ?, 'case', ?, 1, c.removed_at, ${CASE_REMOVAL_REASON_SQL}, ?, ?
            FROM cases c WHERE c.id = ? AND EXISTS (SELECT 1 FROM verdicts WHERE id = ?)`,
      args: [verdictId, caseId, nowIso, nowIso, caseId, verdictId],
    },
  ];
}

const VERDICT_EXISTS = "EXISTS (SELECT 1 FROM verdicts WHERE id = ?)";

function evidenceText(bundle: CaseBundle, mode: CaseMode, appeals: { earlier: AppealRow[]; current: AppealRow | null }) {
  const groups = evidenceGroups(bundle.evidence, mode, appeals);
  return groups.length > 0 ? evidenceBlock(groups) : null;
}

/** First judging of a case (two-sided after the answer, or one-sided). */
export async function runCaseJudging(
  caseId: string,
  judgingToken: string,
  origin: string,
  startedAt: number = Date.now(),
): Promise<void> {
  const row = await getCase(caseId).catch(() => null);
  if (!row || row.status !== "judging" || row.judgingToken !== judgingToken) return;
  const nowIso = () => new Date().toISOString();
  try {
    await ensureOriginalsTables();
  } catch (e) {
    console.error("[cases] originals tables failed:", e instanceof Error ? e.message : String(e));
  }
  const fail = async (code: "quota" | "unavailable") => {
    await entitlementWriteBatch(failJudgingStatements(caseId, judgingToken, row.reservationId, code, nowIso())).catch(
      (e: unknown) => console.error("[cases] failing a run failed:", e instanceof Error ? e.message : String(e)),
    );
  };

  let bundle: CaseBundle;
  try {
    bundle = await loadCaseBundle(row);
  } catch (e) {
    console.error("[cases] load failed:", e instanceof Error ? e.message : String(e));
    return fail("unavailable");
  }
  const mode: CaseMode = row.mode ?? "two_sided";
  const twoSided = mode === "two_sided";
  const noAppeals = { earlier: [], current: null };
  const document = composeForJudging(bundle.sides, mode, noAppeals);
  const evText = evidenceText(bundle, mode, noAppeals);

  // Free cases never carry evidence (refused when submitted), so the free
  // judges get the document alone.
  const run =
    row.tier === "free"
      ? await judgeFree(caseId, { text: document, framework: row.framework, lang: row.lang, twoSided })
      : await judge(caseId, {
          text: document,
          context: evText,
          framework: row.framework,
          lang: row.lang,
          ...(twoSided ? { twoSided: true } : {}),
          ...(evText ? { evidence: true } : {}),
        }, startedAt);
  const outcome = run.outcome;
  if (!outcome || outcome.status === "failed") {
    const code = outcome?.status === "failed" ? outcome.code : "unavailable";
    console.error("[cases] judging failed:", outcome?.status === "failed" ? outcome.error : run.error);
    run.log(null, code);
    return fail(code);
  }

  const result = normalizeCaseResult(outcome.result, {
    twoSided,
    evidenceUsed: evidenceCounts(bundle.evidence, new Set()),
  });
  const verdictId = nanoid(10);
  const at = nowIso();
  const giveBack = outcome.refused || outcome.degraded;
  const runGuard: StatementGuard = {
    sql: "EXISTS (SELECT 1 FROM cases WHERE id = ? AND status = 'judging' AND judging_token = ?)",
    args: [caseId, judgingToken],
  };
  // A free case holds no unit: nothing to consume or refund.
  const charge = row.reservationId
    ? giveBack
      ? refundStatements(row.reservationId, at, verdictGuard(verdictId))
      : [consumeStatement(row.reservationId, verdictId, at, verdictGuard(verdictId))]
    : [];
  let linked = false;
  try {
    const rs = await entitlementWriteBatch([
      ...verdictRowStatements(
        verdictId,
        caseId,
        evText ? `${document}\n\n${evText}` : document,
        row.framework,
        result,
        runGuard,
        at,
      ),
      {
        sql: `INSERT INTO case_verdicts (case_id, seq, verdict_id, appeal_id, mode, created_at)
              SELECT ?, COALESCE((SELECT MAX(seq) FROM case_verdicts WHERE case_id = ?), 0) + 1, ?, NULL, ?, ?
              WHERE EXISTS (SELECT 1 FROM cases WHERE id = ? AND status = 'judging' AND judging_token = ?)
                AND ${VERDICT_EXISTS}`,
        args: [caseId, caseId, verdictId, mode, at, caseId, judgingToken, verdictId],
      },
      {
        sql: `UPDATE cases SET status = 'judged', judged_at = ?, last_error = NULL, updated_at = ?
              WHERE id = ? AND status = 'judging' AND judging_token = ? AND ${VERDICT_EXISTS}`,
        args: [at, at, caseId, judgingToken, verdictId],
      },
      ...charge,
    ]);
    linked = rs[0].rowsAffected === 1;
  } catch (e) {
    console.error("[cases] storing the verdict failed:", e instanceof Error ? e.message : String(e));
    run.log(null, "save_failed");
    return fail("unavailable");
  }
  if (!linked) {
    // The sweep failed this run (and refunded): nothing was written.
    run.log(null, "superseded");
    return;
  }
  run.log(verdictId, outcome.refused ? "refused" : outcome.degraded ? "degraded" : "ok");
  if (twoSided) await notifyOwnerCaseReady(row, origin);
}

/** Re-judging after an appeal: the whole record plus the new context. */
export async function runAppealJudging(
  caseId: string,
  appealId: string,
  attemptToken: string,
  startedAt: number = Date.now(),
): Promise<void> {
  const row = await getCase(caseId).catch(() => null);
  if (!row || row.status !== "judged") return;
  try {
    await ensureOriginalsTables();
  } catch (e) {
    console.error("[cases] originals tables failed:", e instanceof Error ? e.message : String(e));
  }
  let bundle: CaseBundle;
  try {
    bundle = await loadCaseBundle(row);
  } catch (e) {
    console.error("[cases] load failed:", e instanceof Error ? e.message : String(e));
    return;
  }
  const appeal = bundle.appeals.find((a) => a.id === appealId);
  if (!appeal || appeal.status !== "judging" || appeal.attemptToken !== attemptToken) return;
  const nowIso = () => new Date().toISOString();
  const fail = async (error: "quota" | "unavailable" | "refused") => {
    await entitlementWriteBatch(failAppealStatements(appealId, attemptToken, appeal.reservationId, error, nowIso())).catch(
      (e: unknown) => console.error("[cases] failing an appeal failed:", e instanceof Error ? e.message : String(e)),
    );
  };

  const mode: CaseMode = row.mode ?? "two_sided";
  const twoSided = mode === "two_sided";
  const previous = bundle.verdicts.find((v) => v.seq === appeal.baseSeq) ?? bundle.verdicts.at(-1);
  if (!previous?.result) return fail("unavailable");
  const earlier = bundle.appeals
    .filter((a) => a.id !== appealId && a.status === "judged" && a.resultSeq !== null)
    .sort((x, y) => (x.resultSeq ?? 0) - (y.resultSeq ?? 0));
  const appeals = { earlier, current: appeal };
  const document = composeForJudging(bundle.sides, mode, appeals);
  const evText = evidenceText(bundle, mode, appeals);

  const run = await judge(caseId, {
    text: document,
    context: evText,
    framework: row.framework,
    lang: row.lang,
    ...(twoSided ? { twoSided: true } : {}),
    ...(evText ? { evidence: true } : {}),
    // A one-sided case has no second account: its appeal note says so.
    appeal: twoSided ? APPEAL_JUDGE_NOTE : APPEAL_ONE_SIDED_JUDGE_NOTE,
  }, startedAt);
  const outcome = run.outcome;
  if (!outcome || outcome.status === "failed") {
    const code = outcome?.status === "failed" ? outcome.code : "unavailable";
    console.error("[cases] appeal judging failed:", outcome?.status === "failed" ? outcome.error : run.error);
    run.log(null, `appeal_${code}`);
    return fail(code);
  }
  if (outcome.refused) {
    // A refused card would replace a real ruling: fail the appeal instead.
    run.log(null, "appeal_refused");
    return fail("refused");
  }

  const counted = new Set([...earlier.map((a) => a.id), appeal.id]);
  const next = normalizeCaseResult(outcome.result, { twoSided, evidenceUsed: evidenceCounts(bundle.evidence, counted) });
  const prev = previous.result;
  const label = appealOutcome(prev, next);
  // appealSummary never throws (it fails open to ""), so this always logs.
  const summary = await meteredStep(caseId, "appeal_summary", () =>
    appealSummary(prev, next, { party: appeal.party, text: appeal.text }, row.lang, label),
  );
  const info: AppealInfo = {
    by: appeal.party,
    outcome: label,
    previous_id: previous.verdictId,
    previous_verdict: prev.verdict,
    previous_confidence: prev.confidence,
    confidence_change: confidenceChange(prev, next),
    summary,
  };
  const result: VerdictResult = { ...next, appeal: info };
  const verdictId = nanoid(10);
  const at = nowIso();
  const runGuard: StatementGuard = {
    sql: `EXISTS (SELECT 1 FROM case_appeals WHERE id = ? AND status = 'judging' AND attempt_token = ?)
          AND EXISTS (SELECT 1 FROM cases WHERE id = ? AND status = 'judged')`,
    args: [appealId, attemptToken, caseId],
  };
  const charge = outcome.degraded
    ? refundStatements(appeal.reservationId, at, verdictGuard(verdictId))
    : [consumeStatement(appeal.reservationId, verdictId, at, verdictGuard(verdictId))];
  let linked = false;
  try {
    const rs = await entitlementWriteBatch([
      ...verdictRowStatements(
        verdictId,
        caseId,
        evText ? `${document}\n\n${evText}` : document,
        row.framework,
        result,
        runGuard,
        at,
      ),
      {
        sql: `INSERT INTO case_verdicts (case_id, seq, verdict_id, appeal_id, mode, created_at)
              SELECT ?, COALESCE((SELECT MAX(seq) FROM case_verdicts WHERE case_id = ?), 0) + 1, ?, ?, ?, ?
              WHERE EXISTS (SELECT 1 FROM case_appeals WHERE id = ? AND status = 'judging' AND attempt_token = ?)
                AND EXISTS (SELECT 1 FROM cases WHERE id = ? AND status = 'judged')
                AND ${VERDICT_EXISTS}`,
        args: [caseId, caseId, verdictId, appealId, mode, at, appealId, attemptToken, caseId, verdictId],
      },
      {
        sql: `UPDATE case_appeals SET status = 'judged', error = NULL, outcome = ?, updated_at = ?,
                result_seq = (SELECT seq FROM case_verdicts WHERE verdict_id = ?)
              WHERE id = ? AND status = 'judging' AND attempt_token = ?
                AND EXISTS (SELECT 1 FROM case_verdicts WHERE verdict_id = ?)`,
        args: [label, at, verdictId, appealId, attemptToken, verdictId],
      },
      ...charge,
    ]);
    linked = rs[0].rowsAffected === 1;
  } catch (e) {
    console.error("[cases] storing the appeal verdict failed:", e instanceof Error ? e.message : String(e));
    run.log(null, "appeal_save_failed");
    return fail("unavailable");
  }
  if (!linked) {
    run.log(null, "appeal_superseded");
    return;
  }
  run.log(verdictId, outcome.degraded ? "appeal_degraded" : `appeal_${label}`);
}
