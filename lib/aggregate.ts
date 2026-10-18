import type {
  JudgeRunOutput,
  JudgeVerdict,
  JudgeVerdictSide,
  Lean,
  VerdictResult,
} from "./types";

/**
 * Tally of every run's forced `leaning` vote. With an odd number of runs a
 * majority always exists. An even split can only happen when 2 of the 3
 * runs survive, and is broken deterministically, never coin-flipped:
 *   1. a side some run named outright as its verdict beats a side that was
 *      only leaned to (a committed ruling is stronger evidence), then
 *   2. the first surviving run decides (runs keep their config order, so
 *      this is the standard reading, analyzing Party A first).
 */
function tallyLeaning(runs: JudgeRunOutput[]): { side: JudgeVerdictSide; tiebreak: boolean } {
  const aVotes = runs.filter((r) => r.leaning === "side_a").length;
  const bVotes = runs.length - aVotes;
  if (aVotes !== bVotes) {
    return { side: aVotes > bVotes ? "side_a" : "side_b", tiebreak: false };
  }
  const aRulings = runs.filter((r) => r.verdict === "side_a").length;
  const bRulings = runs.filter((r) => r.verdict === "side_b").length;
  if (aRulings !== bRulings) {
    return { side: aRulings > bRulings ? "side_a" : "side_b", tiebreak: true };
  }
  return { side: runs[0].leaning, tiebreak: true };
}

/**
 * Forced-ruling lean from the leaning tally. `reason` is the leaning_reason
 * of the first run that leaned the winning way. `unanimous` is true only when
 * every run leaned that way, so a false `unanimous` is either a 2–1 vote of
 * three runs or (with `tiebreak`) a 1–1 vote of two runs. The tie-break
 * always picks a side that at least one run leaned toward, so a reason
 * always exists.
 */
function computeLean(runs: JudgeRunOutput[]): Lean {
  const { side, tiebreak } = tallyLeaning(runs);
  const leaningRun = runs.find((r) => r.leaning === side) ?? runs[0];
  const lean: Lean = {
    party: side === "side_a" ? "a" : "b",
    unanimous: runs.every((r) => r.leaning === side),
    reason: leaningRun.leaning_reason,
  };
  if (tiebreak) lean.tiebreak = true;
  return lean;
}

/** Drop the run-level fields that must never leak into the stored
 * VerdictResult; only the aggregated `lean` and a non-winner's
 * exception_basis are stored. */
function coreOf(run: JudgeRunOutput) {
  const {
    leaning: _leaning,
    leaning_reason: _leaningReason,
    exception_basis: _exceptionBasis,
    ...core
  } = run;
  void _leaning;
  void _leaningReason;
  void _exceptionBasis;
  return core;
}

function isWinner(v: string): boolean {
  return v === "side_a" || v === "side_b";
}

/** Non-winner verdicts carry the forced ruling and the judge's stated
 * exception basis; winner verdicts carry neither (absent, never null). */
function withNonWinnerFields(
  result: VerdictResult,
  representative: JudgeRunOutput,
  runs: JudgeRunOutput[],
): VerdictResult {
  if (isWinner(result.verdict)) return result;
  result.lean = computeLean(runs);
  if (representative.exception_basis) result.exception_basis = representative.exception_basis;
  return result;
}

/**
 * Turn 1-3 successful judge runs into the final verdict. There is no
 * "too close to call": every outcome names a ruling.
 * Confidence comes from agreement between runs, never from the model:
 *   3/3 same verdict -> 5 (4 if they disagree on dispute_type)
 *   2/3 majority     -> 3 (2 if the dissenter picked the opposite side)
 *   no majority      -> the forced leanings decide, confidence 1:
 *                       the side they favor wins if any run ruled for it
 *                       outright; otherwise the first run leaning that way
 *                       supplies a non-winner verdict that carries the lean.
 */
export function aggregate(runs: JudgeRunOutput[]): VerdictResult {
  if (runs.length === 0) {
    throw new Error("aggregate needs at least one successful run");
  }

  const votes = runs.map((r) => r.verdict);
  const counts = new Map<JudgeVerdict, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  const [topVerdict, topCount] = [...counts.entries()].sort(
    (x, y) => y[1] - x[1],
  )[0];

  const majority = topCount >= 2 || runs.length === 1;

  if (!majority) {
    // Three different verdicts, or two runs that disagree: the forced
    // leanings break it, and the low confidence says how contested it was.
    const { side } = tallyLeaning(runs);
    const representative =
      runs.find((r) => r.verdict === side) ?? runs.find((r) => r.leaning === side) ?? runs[0];
    return withNonWinnerFields(
      { ...coreOf(representative), confidence: 1, runs: votes, demo: false },
      representative,
      runs,
    );
  }

  const representative = runs.find((r) => r.verdict === topVerdict) ?? runs[0];

  let confidence: number;
  if (topCount === runs.length) {
    const sameType = runs.every((r) => r.dispute_type === representative.dispute_type);
    confidence = sameType ? 5 : 4;
  } else {
    const dissenter = runs.find((r) => r.verdict !== topVerdict);
    const opposite =
      (topVerdict === "side_a" && dissenter?.verdict === "side_b") ||
      (topVerdict === "side_b" && dissenter?.verdict === "side_a");
    confidence = opposite ? 2 : 3;
  }

  // Fewer surviving runs = weaker agreement evidence, cap confidence.
  const cap = runs.length >= 3 ? 5 : runs.length === 2 ? 4 : 2;

  return withNonWinnerFields(
    {
      ...coreOf(representative),
      confidence: Math.min(confidence, cap),
      runs: votes,
      demo: false,
    },
    representative,
    runs,
  );
}
