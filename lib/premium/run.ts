/**
 * The premium verdict pipeline, without HTTP, auth or credits: anonymize
 * (argument plus clarification answers, plus evidence transcripts when
 * attached), fact-check, premium panel, then the free tier's escalation and
 * crux trial behind deadline gates. The handler wraps it with the
 * entitlement reserve/consume/refund; scripts can call it directly.
 *
 * judgeAnonymized is the part after anonymization, shared with two-sided
 * cases and appeals (lib/cases), which anonymize each account on its own.
 */

import { aggregate } from "../aggregate";
import { anonymize } from "../anonymize";
import { providerFailure, withUsageMeter, type UsageTotals } from "../claude";
import { loadLocales, t, type Lang } from "../i18n";
import { judgeExtra, type JudgeOptions, type JudgeRun } from "../judge";
import { applyCruxTrial, runCruxTrial, shouldTryCrux } from "../trial";
import type {
  Clarification,
  FactCheck,
  JudgeRunOutput,
  NameMapping,
  VerdictResult,
} from "../types";
import { withClarifications } from "./context";
import { factCheckBlock, runFactCheck } from "./factcheck";
import {
  HAIKU_MODEL,
  isHaiku,
  judgePremiumPanel,
  premiumPanel,
  SEAT_RETRY_TIMEOUT_MS,
  type PanelOptions,
} from "./panel";
import type { VerifiedEvidence } from "../evidence";

/** Escalation starts only before this much of the request has passed, the
 * crux trial only before the second mark, and (on case, evidence and appeal
 * runs) a refused seat's Haiku rerun only before the third. Worst cases,
 * all inside maxDuration = 300:
 * - plain premium: anonymize 60s + fact-check 40s + judges 120s = 220s, plus
 *   a seat rerun (60s) = 280s; escalation and the trial are then skipped;
 * - with evidence, or a case answer/appeal judged in the same invocation:
 *   anonymize up to 120s + fact-check 40s + judges 120s = 280s; the rerun
 *   gate skips the rerun rather than run past 280s.
 * Callers pass the request's start as `startedAt`, so time spent
 * anonymizing counts. */
export const ESCALATION_CUTOFF_MS = 150_000;
export const TRIAL_CUTOFF_MS = 225_000;
export const SEAT_RETRY_CUTOFF_MS = 280_000 - SEAT_RETRY_TIMEOUT_MS;

export type PremiumInput = {
  argument: string;
  clarifications?: Clarification[];
  lang: Lang;
  /** Verified evidence transcripts (raw). Absent or empty: today's path. */
  evidence?: VerifiedEvidence[];
};

/** An already anonymized document to judge (premium argument, two-sided
 * case document, or a case plus appeal context). */
export type JudgeInput = {
  text: string;
  /** Extra judge context placed before the FACT-CHECK block (the EVIDENCE
   * block). The fact-check itself sees `text` only. */
  context: string | null;
  lang: Lang;
  twoSided?: boolean;
  evidence?: boolean;
  /** Appeal note for the judges' system prompt (APPEAL_JUDGE_NOTE). */
  appeal?: string;
};

export type PremiumStats = {
  factCheck: FactCheck["status"];
  claims: number;
  escalated: boolean;
  trial: boolean;
  ms: number;
};

export type PremiumOutcome =
  | {
      status: "ok";
      /** Final result, tier/fact_check/panel/lang set; ready to store. */
      result: VerdictResult;
      /** The anonymized text that was judged (what gets stored). */
      input: string;
      nameMap: NameMapping[];
      /** True when every judge declined (the refused result, refunded). */
      refused: boolean;
      /** True when the panel has strong (non-Haiku) seats but none of them
       * produced a run: the verdict rests on Haiku alone, so it is shown but
       * not charged. */
      degraded: boolean;
    }
  | { status: "anonymize_failed"; error: string }
  | { status: "failed"; code: "quota" | "unavailable"; error: string };

/** judgeAnonymized's outcome: PremiumOutcome without the anonymize step. */
export type JudgedOutcome =
  | Omit<Extract<PremiumOutcome, { status: "ok" }>, "nameMap">
  | Extract<PremiumOutcome, { status: "failed" }>;

export type PremiumRun = { outcome: PremiumOutcome; usage: UsageTotals; stats: PremiumStats };

/** Integer env setting clamped to [min, max] (same reading as the free route). */
function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

/** The free tier's honest output when the model declines to judge. */
export function refusedPremiumResult(lang: Lang): VerdictResult {
  return {
    verdict: "too_close",
    dispute_type: "mixed",
    confidence: 1,
    headline: t(lang, "refused.headline"),
    crux: t(lang, "refused.crux"),
    split_points: null,
    conditional: null,
    argument_map: {
      side_a: [{ claim: t(lang, "refused.claim"), kind: "logic" }],
      side_b: [{ claim: t(lang, "refused.claim"), kind: "logic" }],
      bedrock_a: "—",
      bedrock_b: "—",
    },
    facts_relied_on: [],
    losing_side_best_point: t(lang, "refused.bestPoint"),
    runs: [],
    demo: false,
    model_refused: true,
  };
}

/**
 * Runs the pipeline. Never throws for model failures (they come back as
 * outcomes); an unexpected throw propagates so the caller can refund.
 * `startedAt`/`now` drive the deadline gates (the request's start time).
 */
export async function runPremiumPipeline(
  input: PremiumInput,
  opts: { startedAt?: number; now?: () => number } = {},
): Promise<PremiumRun> {
  const now = opts.now ?? Date.now;
  const startedAt = opts.startedAt ?? now();
  const stats: PremiumStats = { factCheck: "unavailable", claims: 0, escalated: false, trial: false, ms: 0 };
  const { value: outcome, usage } = await withUsageMeter(() => pipeline(input, startedAt, now, stats));
  stats.ms = now() - startedAt;
  return { outcome, usage, stats };
}

async function pipeline(input: PremiumInput, startedAt: number, now: () => number, stats: PremiumStats): Promise<PremiumOutcome> {
  const prepared = await preparePremium(input);
  if (!prepared.ok) return { status: "anonymize_failed", error: prepared.error };
  return judgePrepared(prepared.prepared, input, startedAt, now, stats);
}

/** A premium submission after anonymization: what the judges may see. */
export type PreparedPremium = {
  anonymized: string;
  nameMap: NameMapping[];
  /** The anonymized EVIDENCE block, or null without evidence. */
  evidenceText: string | null;
  evidenceCount: number;
};

/**
 * The anonymize step on its own (async verdicts run it inside the request,
 * then judge in the background). Fails closed, as on free: names in the
 * argument or the answers must never reach the search engine, the judges
 * or the database. Never throws.
 */
export async function preparePremium(
  { argument, clarifications, lang, evidence }: Pick<PremiumInput, "argument" | "clarifications" | "lang" | "evidence">,
): Promise<{ ok: true; prepared: PreparedPremium } | { ok: false; error: string }> {
  const argumentText = withClarifications(argument, clarifications, lang);
  try {
    if (evidence && evidence.length > 0) {
      // Loaded only with evidence, so a plain premium request runs exactly
      // as before. One call anonymizes the account and its transcripts with
      // one name map.
      const ev = await import("../evidence");
      const sub = await ev.anonymizeSubmission({ narrator: "Party A", text: argumentText, evidence, lang });
      return {
        ok: true,
        prepared: {
          anonymized: sub.text,
          nameMap: sub.nameMap,
          evidenceCount: sub.evidence.length,
          evidenceText: ev.evidenceBlock([{ party: null, idPrefix: "E", items: sub.evidence }]),
        },
      };
    }
    const { text, nameMap } = await anonymize(argumentText);
    return { ok: true, prepared: { anonymized: text, nameMap, evidenceText: null, evidenceCount: 0 } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The judge step after preparePremium (fact-check, panel, escalation, crux
 * trial). Sees only the prepared, anonymized text. */
async function judgePrepared(
  { anonymized, nameMap, evidenceText, evidenceCount }: PreparedPremium,
  { lang }: Pick<PremiumInput, "lang">,
  startedAt: number,
  now: () => number,
  stats: PremiumStats,
): Promise<PremiumOutcome> {
  const judged = await judgeAnonymized(
    { text: anonymized, context: evidenceText, lang, ...(evidenceText ? { evidence: true } : {}) },
    { startedAt, now, stats },
  );
  if (judged.status !== "ok") return judged;
  if (!evidenceText) return { ...judged, nameMap };
  return {
    ...judged,
    result: { ...judged.result, evidence_used: { a: evidenceCount, b: 0 } },
    input: `${anonymized}

${evidenceText}`,
    nameMap,
  };
}

/**
 * runPremiumPipeline for an already prepared submission (the async
 * background run). `startedAt` is the request's start, so the deadline
 * gates count the time spent anonymizing; `anonymizeUsage` (metered in the
 * request) is added to the run's usage for its log line.
 */
export async function runPreparedPipeline(
  prepared: PreparedPremium,
  input: Pick<PremiumInput, "lang">,
  opts: { startedAt: number; now?: () => number; anonymizeUsage?: UsageTotals },
): Promise<PremiumRun> {
  const now = opts.now ?? Date.now;
  const stats: PremiumStats = { factCheck: "unavailable", claims: 0, escalated: false, trial: false, ms: 0 };
  const { value: outcome, usage } = await withUsageMeter(() => judgePrepared(prepared, input, opts.startedAt, now, stats));
  stats.ms = now() - opts.startedAt;
  return { outcome, usage: opts.anonymizeUsage ? mergeUsage(opts.anonymizeUsage, usage) : usage, stats };
}

/** Two usage totals added up (per model too). */
export function mergeUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  const byModel: UsageTotals["byModel"] = {};
  for (const src of [a.byModel, b.byModel]) {
    for (const [model, m] of Object.entries(src)) {
      const into = (byModel[model] ??= { calls: 0, input: 0, output: 0, searches: 0 });
      into.calls += m.calls;
      into.input += m.input;
      into.output += m.output;
      into.searches += m.searches;
    }
  }
  return {
    calls: a.calls + b.calls,
    input: a.input + b.input,
    output: a.output + b.output,
    searches: a.searches + b.searches,
    byModel,
  };
}

/**
 * Judges an anonymized document: fact-check (on `text` only), the premium
 * panel with [context, FACT-CHECK] as context, then escalation and the crux
 * trial behind the deadline gates measured from `startedAt`. Never throws
 * for model failures. `input` in the outcome is `text`.
 */
export async function judgeAnonymized(
  input: JudgeInput,
  opts: { startedAt?: number; now?: () => number; stats?: PremiumStats } = {},
): Promise<JudgedOutcome> {
  const { text, lang } = input;
  await loadLocales();
  const now = opts.now ?? Date.now;
  const startedAt = opts.startedAt ?? now();
  const stats = opts.stats ?? { factCheck: "unavailable", claims: 0, escalated: false, trial: false, ms: 0 };

  const factCheck = await runFactCheck(text, lang);
  stats.factCheck = factCheck.status;
  stats.claims = factCheck.claims.length;
  const factContext = factCheckBlock(factCheck);
  const context = [input.context, factContext].filter((c): c is string => Boolean(c)).join("\n\n") || null;

  // Case options are only passed when set, so a plain premium run calls the
  // panel and the extra judges exactly as before.
  const caseOpts: PanelOptions = {
    ...(input.twoSided ? { twoSided: true } : {}),
    ...(input.evidence ? { evidence: true } : {}),
    ...(input.appeal ? { appeal: input.appeal } : {}),
  };
  const hasCaseOpts = Object.keys(caseOpts).length > 0;

  // The rerun gate only rides along with case options: a plain premium run
  // (anonymize 60s) always fits and keeps exactly its old call.
  const panel = hasCaseOpts
    ? await judgePremiumPanel(text, lang, context, premiumPanel(), caseOpts, {
        allowRetry: () => now() - startedAt < SEAT_RETRY_CUTOFF_MS,
      })
    : await judgePremiumPanel(text, lang, context);
  const ok = panel.runs.filter((r) => r.ok).map((r) => r.data as JudgeRunOutput);
  const premiumFields = { tier: "premium" as const, fact_check: factCheck, lang };

  if (ok.length === 0) {
    if (panel.runs.every((r) => !r.ok && r.blocked)) {
      return {
        status: "ok",
        result: { ...refusedPremiumResult(lang), ...premiumFields, panel: { models: [] } },
        input: text,
        refused: true,
        degraded: false,
      };
    }
    const firstError = panel.runs.find((r) => !r.ok);
    const detail = firstError && !firstError.ok ? firstError.error : "?";
    const failure = providerFailure(detail);
    const quota = failure === "provider_rate" || failure === "provider_credit";
    return { status: "failed", code: quota ? "quota" : "unavailable", error: detail };
  }

  // Read before escalation, which only ever adds Haiku runs.
  const degraded = premiumPanel().some((s) => !isHaiku(s.model)) && panel.models.every(isHaiku);
  let result = aggregate(ok);
  let models = panel.models;

  const extra = intEnv("JUDGE_EXTRA_RUNS", 2, 0, 4);
  if (
    extra > 0 &&
    result.confidence <= intEnv("JUDGE_ESCALATE_AT", 2, 0, 5) &&
    now() - startedAt < ESCALATION_CUTOFF_MS
  ) {
    const extraOpts: Pick<JudgeOptions, "context" | "premium" | "twoSided" | "evidence" | "appeal"> = {
      premium: true,
      ...(context ? { context } : {}),
      ...caseOpts,
    };
    const more = await judgeExtra(extra, text, lang, extraOpts).catch((): JudgeRun[] => []);
    const moreOk = more.filter((r) => r.ok).map((r) => r.data as JudgeRunOutput);
    if (moreOk.length > 0) {
      result = { ...aggregate([...ok, ...moreOk]), escalated: true };
      models = [...models, ...moreOk.map(() => HAIKU_MODEL)];
      stats.escalated = true;
    }
  }

  if (process.env.CRUX_TRIAL !== "0" && shouldTryCrux(result) && now() - startedAt < TRIAL_CUTOFF_MS) {
    // The attacker and adjudicator see the same evidence the judges saw.
    const trial = await runCruxTrial(context ? `${text}\n\n${context}` : text, result, lang);
    if (trial) {
      result = applyCruxTrial(result, trial);
      stats.trial = true;
    }
  }

  return {
    status: "ok",
    result: { ...result, ...premiumFields, panel: { models } },
    input: text,
    refused: false,
    degraded,
  };
}

/** One log line per premium verdict: outcome, steps and usage counts, never
 * content. */
export function premiumLogLine(
  id: string | null,
  outcome: string,
  run: Pick<PremiumRun, "usage" | "stats">,
): string {
  const { usage, stats } = run;
  const byModel = Object.entries(usage.byModel)
    .map(([model, m]) => `${model}:${m.calls}x/${m.input}in/${m.output}out`)
    .join(",");
  return [
    "[premium] verdict",
    `id=${id ?? "-"}`,
    `outcome=${outcome}`,
    `fact_check=${stats.factCheck}`,
    `claims=${stats.claims}`,
    `escalated=${stats.escalated ? 1 : 0}`,
    `trial=${stats.trial ? 1 : 0}`,
    `ms=${stats.ms}`,
    `calls=${usage.calls}`,
    `in=${usage.input}`,
    `out=${usage.output}`,
    `total=${usage.input + usage.output}`,
    `searches=${usage.searches}`,
    `models=${byModel || "-"}`,
  ].join(" ");
}
