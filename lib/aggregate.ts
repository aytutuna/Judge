import type { JudgeRunOutput, JudgeVerdict, Lean, VerdictResult } from "./types";

/**
 * Forced-ruling lean: the majority of every run's forced `leaning` vote.
 * With 3 or 1 runs a majority always exists; with 2 runs a 1–1 tie returns
 * null — genuinely even, shown as such, never coin-flipped. `reason` is the
 * leaning_reason of the first run that voted with the majority.
 *
 * Provable, and the UI relies on it: a non-unanimous non-null lean only
 * occurs with exactly 3 runs (2 disagreeing runs are a tie), so a false
 * `unanimous` is always a 2–1 vote.
 */
function computeLean(runs: JudgeRunOutput[]): Lean | null {
  const aVotes = runs.filter((r) => r.leaning === "side_a").length;
  const bVotes = runs.length - aVotes;
  if (aVotes === bVotes) return null;
  const winner: JudgeRunOutput["leaning"] = aVotes > bVotes ? "side_a" : "side_b";
  const majorityRun = runs.find((r) => r.leaning === winner);
  if (!majorityRun) return null; // unreachable: the winner has >= 1 vote
  return {
    party: winner === "side_a" ? "a" : "b",
    unanimous: runs.every((r) => r.leaning === winner),
    reason: majorityRun.leaning_reason,
  };
}

/**
 * Turn 1-3 successful judge runs into the final verdict.
 * Confidence comes from agreement between runs, never from the model:
 *   3/3 same verdict -> 5 (4 if they disagree on dispute_type)
 *   2/3 majority     -> 3 (2 if the dissenter picked the opposite side)
 *   no majority      -> "too_close", confidence 1
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
  const representative =
    runs.find((r) => r.verdict === topVerdict) ?? runs[0];
  // Spread hygiene: the run-level forced-ruling fields must never leak into
  // the stored VerdictResult — only the aggregated `lean` is stored.
  const { leaning: _leaning, leaning_reason: _leaningReason, ...core } = representative;
  void _leaning;
  void _leaningReason;

  if (!majority) {
    // Three-way disagreement: honest "too close to call", but still show the
    // richest analysis we have so the user sees the map and crux.
    return {
      ...core,
      verdict: "too_close",
      confidence: 1,
      headline: "Too close to call",
      runs: votes,
      demo: false,
      lean: computeLean(runs),
    };
  }

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

  const result: VerdictResult = {
    ...core,
    confidence: Math.min(confidence, cap),
    runs: votes,
    demo: false,
  };
  // Winner verdicts already name a winner: `lean` stays absent (undefined,
  // never null). Every other majority verdict carries the forced ruling.
  if (topVerdict !== "side_a" && topVerdict !== "side_b") {
    result.lean = computeLean(runs);
  }
  return result;
}
