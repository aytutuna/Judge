/**
 * The free verdict after anonymization: self-consistent judges, escalation
 * on a low-confidence first round, then the crux trial. Shared by the
 * synchronous route and the async background run, so both judge exactly
 * the same way. Sees only anonymized text. Never throws for model failures.
 */

import { aggregate } from "@/lib/aggregate";
import { t, type Lang } from "@/lib/i18n";
import { judgeExtra, judgeSelfConsistent, type JudgeRun } from "@/lib/judge";
import { applyCruxTrial, runCruxTrial, shouldTryCrux } from "@/lib/trial";
import type { FrameworkChoice, JudgeRunOutput, VerdictResult } from "@/lib/types";

/** Integer env setting clamped to [min, max]; unset, empty or non-numeric
 * reads as the default. */
function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

/** Honest output when the model's own safety filter declines to judge.
 * Stored localized — consistent with stored CONTENT keeping its judged
 * language. */
export function refusedResult(lang: Lang): VerdictResult {
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

export type FreeJudged =
  | { ok: true; result: VerdictResult }
  | { ok: false; code: "quota" | "unavailable"; detail: string };

/** Judges anonymized text. A refusal by every judge is an ok refused
 * result; `result.lang` is set. */
export async function judgeFreeAnonymized(
  anonymized: string,
  framework: FrameworkChoice,
  lang: Lang,
): Promise<FreeJudged> {
  let result: VerdictResult;
  const runs = await judgeSelfConsistent(anonymized, framework, lang);
  const ok = runs.filter((r) => r.ok).map((r) => r.data as JudgeRunOutput);
  if (ok.length === 0) {
    if (!runs.every((r) => !r.ok && r.blocked)) {
      const firstError = runs.find((r) => !r.ok);
      const detail = firstError && !firstError.ok ? firstError.error : "?";
      // claudeJson keeps the HTTP status in its error text ("Claude HTTP 429: …").
      return { ok: false, code: /HTTP 429/.test(detail) ? "quota" : "unavailable", detail };
    }
    result = refusedResult(lang);
  } else {
    result = aggregate(ok);
    // Escalation: a low-confidence first round calls in a few more judges
    // (in parallel) and every vote is counted again. Fail-open: if no extra
    // run succeeds, the first result stands as it was.
    const extra = intEnv("JUDGE_EXTRA_RUNS", 2, 0, 4);
    if (extra > 0 && result.confidence <= intEnv("JUDGE_ESCALATE_AT", 2, 0, 5)) {
      const more = await judgeExtra(extra, anonymized, framework, lang).catch((): JudgeRun[] => []);
      const moreOk = more.filter((r) => r.ok).map((r) => r.data as JudgeRunOutput);
      console.info(
        `[verdict] escalated at confidence ${result.confidence}: ${moreOk.length}/${extra} extra runs ok, ${ok.length + moreOk.length} runs counted`,
      );
      if (moreOk.length > 0) result = { ...aggregate([...ok, ...moreOk]), escalated: true };
    }
    // Crux trial: cross-examine fact/logic winner rulings before saving, so
    // shared /v/[id] pages get the trial for free. runCruxTrial never throws
    // and never exceeds its ~60s deadline; null means the verdict ships
    // untried (failure-open). CRUX_TRIAL=0 is the tight-quota kill switch.
    if (process.env.CRUX_TRIAL !== "0" && shouldTryCrux(result)) {
      const trial = await runCruxTrial(anonymized, result, lang);
      if (trial) result = applyCruxTrial(result, trial);
    }
  }
  // Record the content language so a later translation knows its source.
  return { ok: true, result: { ...result, lang } };
}
