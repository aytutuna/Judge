/**
 * Premium judge panel: a configurable mix of models (two Sonnet seats and
 * one Haiku seat by default), run in parallel through the same judgeOnce as
 * the free panel, with the FACT-CHECK context and the premium note. The
 * free panel (judgeSelfConsistent) is not involved.
 */

import { defaultJudgeEffort, type Effort } from "../claude";
import type { Lang } from "../i18n";
import { judgeOnce, type JudgeRun } from "../judge";
import type { FrameworkChoice } from "../types";

export const HAIKU_MODEL = "claude-haiku-5-5";
export const DEFAULT_PANEL = ["claude-sonnet-5-5", "claude-sonnet-5-5", HAIKU_MODEL] as const;
const MAX_SEATS = 5;
const MODEL_NAME = /^claude-[a-z0-9.-]+$/;
const EFFORTS: readonly Effort[] = ["low", "medium", "high"];

/** Budget for a refused seat's one rerun on Haiku. Keeps the worst case
 * (anonymize 60s + fact-check 40s + judges 120s + rerun 60s = 280s) inside
 * maxDuration; the route's deadline gates then skip escalation and trial. */
export const SEAT_RETRY_TIMEOUT_MS = 60_000;

export type PanelSeat = { model: string; analyzeBFirst: boolean; effort: Effort };

export function isHaiku(model: string): boolean {
  return model.includes("haiku");
}

/**
 * Seats from PREMIUM_JUDGE_MODELS (comma-separated, 1 to 5, in order; unset
 * or nothing valid -> the default panel). Odd seats analyze Party B first.
 * Non-Haiku seats use PREMIUM_SONNET_EFFORT (default medium); Haiku seats
 * keep the free judges' effort (JUDGE_EFFORT, else medium).
 */
export function premiumPanel(env: Record<string, string | undefined> = process.env): PanelSeat[] {
  const listed = (env.PREMIUM_JUDGE_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => MODEL_NAME.test(m))
    .slice(0, MAX_SEATS);
  const models = listed.length ? listed : [...DEFAULT_PANEL];
  const raw = env.PREMIUM_SONNET_EFFORT?.trim() as Effort | undefined;
  const strongEffort: Effort = raw && EFFORTS.includes(raw) ? raw : "medium";
  return models.map((model, i) => ({
    model,
    analyzeBFirst: i % 2 === 1,
    effort: isHaiku(model) ? defaultJudgeEffort() : strongEffort,
  }));
}

/**
 * Runs every seat in parallel. A seat the model refused (blocked) on a
 * non-Haiku model is rerun once on Haiku with the same configuration; the
 * model that actually served is what gets recorded. Never throws: failed
 * seats come back as failed runs.
 *
 * `runs` holds one entry per seat; `models` lists the model of each
 * SUCCESSFUL run, in seat order, so it lines up with the runs aggregate()
 * counts.
 */
export async function judgePremiumPanel(
  text: string,
  framework: FrameworkChoice,
  lang: Lang,
  context: string | null,
  seats: PanelSeat[] = premiumPanel(),
): Promise<{ runs: JudgeRun[]; models: string[] }> {
  const common = { lang, premium: true, ...(context ? { context } : {}) };
  const served = await Promise.all(
    seats.map(async (seat, i): Promise<{ run: JudgeRun; model: string }> => {
      const run = await judgeOnce(text, framework, {
        ...common,
        analyzeBFirst: seat.analyzeBFirst,
        model: seat.model,
        effort: seat.effort,
      }).catch((e: unknown): JudgeRun => ({
        ok: false,
        blocked: false,
        error: e instanceof Error ? e.message : String(e),
      }));
      if (!run.ok) {
        const why = run.blocked ? "refused" : "failed";
        console.warn(`[premium] seat ${i} (${seat.model}) ${why}: ${run.error.slice(0, 200)}`);
      }
      if (run.ok || !run.blocked || isHaiku(seat.model)) return { run, model: seat.model };
      console.warn(`[premium] ${seat.model} seat refused; rerunning it on ${HAIKU_MODEL}`);
      const retry = await judgeOnce(text, framework, {
        ...common,
        analyzeBFirst: seat.analyzeBFirst,
        model: HAIKU_MODEL,
        effort: defaultJudgeEffort(),
        timeoutMs: SEAT_RETRY_TIMEOUT_MS,
      }).catch((): JudgeRun => run);
      return { run: retry, model: HAIKU_MODEL };
    }),
  );
  return {
    runs: served.map((s) => s.run),
    models: served.filter((s) => s.run.ok).map((s) => s.model),
  };
}
