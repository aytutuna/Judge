import type { JudgeRunOutput } from "./types";

/**
 * A clear winner is the default ruling. split, conditional and dissolved are
 * exceptions, and a run may only use one when its output shows the
 * exception's criterion is met:
 *   - every exception: a non-empty exception_basis sentence
 *   - split: at least one split point for EACH party
 *   - conditional: at least two if/then branches
 * The prompt asks for all of this; this check makes it hold regardless.
 */
export function meetsExceptionCriteria(run: JudgeRunOutput): boolean {
  if (run.verdict === "side_a" || run.verdict === "side_b") return true;
  if (!run.exception_basis?.trim()) return false;
  switch (run.verdict) {
    case "split": {
      const points = run.split_points ?? [];
      return points.some((p) => p.party === "a") && points.some((p) => p.party === "b");
    }
    case "conditional":
      return (run.conditional ?? []).length >= 2;
    case "dissolved":
      return true;
  }
}

/**
 * Normalize one judge run against the exception criteria. Pure.
 *
 * - Winner runs: the forced leaning must equal the verdict (the prompt
 *   requires it; aggregation tallies leanings when verdicts disagree), and
 *   exception_basis is cleared.
 * - Exception runs that fail their criteria fall back to the run's own forced
 *   ruling: the leaning side becomes the verdict and its leaning_reason
 *   replaces the headline, which was written for the dropped exception.
 */
export function enforceCriteria(run: JudgeRunOutput): {
  run: JudgeRunOutput;
  downgraded: boolean;
} {
  if (run.verdict === "side_a" || run.verdict === "side_b") {
    return { run: { ...run, leaning: run.verdict, exception_basis: null }, downgraded: false };
  }
  if (meetsExceptionCriteria(run)) {
    return { run: { ...run, exception_basis: run.exception_basis?.trim() ?? null }, downgraded: false };
  }
  return {
    run: {
      ...run,
      verdict: run.leaning,
      headline: run.leaning_reason,
      split_points: null,
      conditional: null,
      exception_basis: null,
    },
    downgraded: true,
  };
}
