import type { JudgeRunOutput, JudgeVerdict, Lean, VerdictResult } from "./types";

/**
 * Forced-ruling lean: the strict majority of every run's forced `leaning`
 * vote. With an odd run count a majority always exists; with an even count
 * a tie returns null — genuinely even, shown as such, never coin-flipped.
 * `reason` is the leaning_reason of the first run that voted with the
 * majority.
 *
 * `tally` is stored only when the split cannot be inferred from the run
 * count: up to 3 runs a non-unanimous non-null lean is always 2–1 (2
 * disagreeing runs are a tie), so the UI reads a missing tally as
 * (runs - 1)–1, which also covers every pre-escalation row.
 */
function computeLean(runs: JudgeRunOutput[]): Lean | null {
  const aVotes = runs.filter((r) => r.leaning === "side_a").length;
  const bVotes = runs.length - aVotes;
  if (aVotes === bVotes) return null;
  const winner: JudgeRunOutput["leaning"] = aVotes > bVotes ? "side_a" : "side_b";
  const majorityRun = runs.find((r) => r.leaning === winner);
  if (!majorityRun) return null; // unreachable: the winner has >= 1 vote
  const forVotes = Math.max(aVotes, bVotes);
  const lean: Lean = {
    party: winner === "side_a" ? "a" : "b",
    unanimous: forVotes === runs.length,
    reason: majorityRun.leaning_reason,
  };
  if (!lean.unanimous && runs.length > 3) {
    lean.tally = { for: forVotes, against: runs.length - forVotes };
  }
  return lean;
}

/** Share of runs whose forced lean agrees with `lean` (0 for a tie). */
function leanShare(runs: JudgeRunOutput[], lean: Lean | null): number {
  if (!lean) return 0;
  const side = lean.party === "a" ? "side_a" : "side_b";
  return runs.filter((r) => r.leaning === side).length / runs.length;
}

/**
 * Turn 1-7 successful judge runs (3 by default, more after escalation) into
 * the final verdict. Confidence comes from agreement between runs, never
 * from the model:
 *   all agree        -> 5 (4 if they disagree on dispute_type)
 *   strict majority  -> by agreement share: >= 80% -> 4, >= 60% -> 3, else 2;
 *                       one less (floor 2) if a dissenter picked the
 *                       opposite side. 2/3 -> 3 (2), 3/5 -> 3, 4/5 -> 4.
 *   no majority      -> the leaned side if >= 80% of forced leans name it
 *                       (unanimous up to 3 runs) and a run ruled for it,
 *                       confidence 2; otherwise "too_close", confidence 1
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

  const majority = topCount > runs.length / 2 || runs.length === 1;
  const representative =
    runs.find((r) => r.verdict === topVerdict) ?? runs[0];
  // Spread hygiene: the run-level forced-ruling fields must never leak into
  // the stored VerdictResult — only the aggregated `lean` is stored.
  const { leaning: _leaning, leaning_reason: _leaningReason, ...core } = representative;
  void _leaning;
  void _leaningReason;

  if (!majority) {
    // No verdict majority, but the forced leans name one side with
    // near-unanimity (>= 80%; for up to 3 runs that means every run) and at
    // least one run ruled for it outright: that side wins at low confidence.
    // The winner run is the representative, so the headline and analysis
    // already argue for the side that won.
    const lean = computeLean(runs);
    const winnerVerdict = lean?.party === "a" ? "side_a" : "side_b";
    const winnerRun =
      leanShare(runs, lean) >= 0.8
        ? runs.find((r) => r.verdict === winnerVerdict)
        : undefined;
    if (winnerRun) {
      const { leaning: _l, leaning_reason: _lr, ...winnerCore } = winnerRun;
      void _l;
      void _lr;
      return { ...winnerCore, confidence: 2, runs: votes, demo: false };
    }
    // Scattered disagreement: honest "too close to call", but still show the
    // richest analysis we have so the user sees the map and crux.
    return {
      ...core,
      verdict: "too_close",
      confidence: 1,
      headline: "Too close to call",
      runs: votes,
      demo: false,
      lean,
    };
  }

  let confidence: number;
  if (topCount === runs.length) {
    const sameType = runs.every((r) => r.dispute_type === representative.dispute_type);
    confidence = sameType ? 5 : 4;
  } else {
    const share = topCount / runs.length;
    confidence = share >= 0.8 ? 4 : share >= 0.6 ? 3 : 2;
    const opposite = runs.some(
      (r) =>
        (topVerdict === "side_a" && r.verdict === "side_b") ||
        (topVerdict === "side_b" && r.verdict === "side_a"),
    );
    if (opposite) confidence = Math.max(2, confidence - 1);
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
