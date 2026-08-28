import type { JudgeOutput, JudgeVerdict, VerdictResult } from "./types";

/**
 * Turn 1-3 successful judge runs into the final verdict.
 * Confidence comes from agreement between runs, never from the model:
 *   3/3 same verdict -> 5 (4 if they disagree on dispute_type)
 *   2/3 majority     -> 3 (2 if the dissenter picked the opposite side)
 *   no majority      -> "too_close", confidence 1
 */
export function aggregate(runs: JudgeOutput[]): VerdictResult {
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

  if (!majority) {
    // Three-way disagreement: honest "too close to call", but still show the
    // richest analysis we have so the user sees the map and crux.
    return {
      ...representative,
      verdict: "too_close",
      confidence: 1,
      headline: "Too close to call",
      runs: votes,
      demo: false,
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

  return {
    ...representative,
    confidence: Math.min(confidence, cap),
    runs: votes,
    demo: false,
  };
}
