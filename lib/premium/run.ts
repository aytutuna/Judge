/**
 * The premium verdict pipeline, without HTTP, auth or credits: anonymize
 * (argument plus clarification answers), fact-check, premium panel, then the
 * free tier's escalation and crux trial behind deadline gates. The handler
 * wraps it with the entitlement reserve/consume/refund; scripts can call it
 * directly.
 */

import { aggregate } from "../aggregate";
import { anonymize } from "../anonymize";
import { withUsageMeter, type UsageTotals } from "../claude";
import { t, type Lang } from "../i18n";
import { judgeExtra, type JudgeRun } from "../judge";
import { applyCruxTrial, runCruxTrial, shouldTryCrux } from "../trial";
import type {
  Clarification,
  FactCheck,
  FrameworkChoice,
  JudgeRunOutput,
  NameMapping,
  VerdictResult,
} from "../types";
import { withClarifications } from "./context";
import { factCheckBlock, runFactCheck } from "./factcheck";
import { HAIKU_MODEL, isHaiku, judgePremiumPanel, premiumPanel } from "./panel";

/** Escalation starts only before this much of the request has passed, the
 * crux trial only before the second mark. With anonymize 60s + fact-check
 * 40s + judges 120s = 220s worst case, escalation is skipped and the trial
 * (60s) still ends by 280s, inside maxDuration = 300. */
export const ESCALATION_CUTOFF_MS = 150_000;
export const TRIAL_CUTOFF_MS = 225_000;

export type PremiumInput = {
  argument: string;
  clarifications?: Clarification[];
  framework: FrameworkChoice;
  lang: Lang;
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

async function pipeline(
  { argument, clarifications, framework, lang }: PremiumInput,
  startedAt: number,
  now: () => number,
  stats: PremiumStats,
): Promise<PremiumOutcome> {
  // Fail closed, as on free: names in the argument or the answers must never
  // reach the search engine, the judges or the database.
  let anonymized: string;
  let nameMap: NameMapping[];
  try {
    ({ text: anonymized, nameMap } = await anonymize(withClarifications(argument, clarifications, lang)));
  } catch (e) {
    return { status: "anonymize_failed", error: e instanceof Error ? e.message : String(e) };
  }

  const factCheck = await runFactCheck(anonymized, lang);
  stats.factCheck = factCheck.status;
  stats.claims = factCheck.claims.length;
  const context = factCheckBlock(factCheck);

  const panel = await judgePremiumPanel(anonymized, framework, lang, context);
  const ok = panel.runs.filter((r) => r.ok).map((r) => r.data as JudgeRunOutput);
  const premiumFields = { tier: "premium" as const, fact_check: factCheck, lang };

  if (ok.length === 0) {
    if (panel.runs.every((r) => !r.ok && r.blocked)) {
      return {
        status: "ok",
        result: { ...refusedPremiumResult(lang), ...premiumFields, panel: { models: [] } },
        input: anonymized,
        nameMap,
        refused: true,
        degraded: false,
      };
    }
    const firstError = panel.runs.find((r) => !r.ok);
    const detail = firstError && !firstError.ok ? firstError.error : "?";
    return { status: "failed", code: /HTTP 429/.test(detail) ? "quota" : "unavailable", error: detail };
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
    const more = await judgeExtra(extra, anonymized, framework, lang, {
      premium: true,
      ...(context ? { context } : {}),
    }).catch((): JudgeRun[] => []);
    const moreOk = more.filter((r) => r.ok).map((r) => r.data as JudgeRunOutput);
    if (moreOk.length > 0) {
      result = { ...aggregate([...ok, ...moreOk]), escalated: true };
      models = [...models, ...moreOk.map(() => HAIKU_MODEL)];
      stats.escalated = true;
    }
  }

  if (process.env.CRUX_TRIAL !== "0" && shouldTryCrux(result) && now() - startedAt < TRIAL_CUTOFF_MS) {
    // The attacker and adjudicator see the same evidence the judges saw.
    const trial = await runCruxTrial(context ? `${anonymized}\n\n${context}` : anonymized, result, lang);
    if (trial) {
      result = applyCruxTrial(result, trial);
      stats.trial = true;
    }
  }

  return {
    status: "ok",
    result: { ...result, ...premiumFields, panel: { models } },
    input: anonymized,
    nameMap,
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
