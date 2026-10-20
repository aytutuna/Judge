/** How a re-judged verdict compares to the one before it. Pure. */

import type { AppealOutcome, VerdictResult } from "@/lib/types";

const win = (v: VerdictResult["verdict"]) => v === "side_a" || v === "side_b";

/**
 * overturned: a winner verdict now names the other winner.
 * upheld: the same verdict, and for non-winner verdicts the same forced lean.
 * changed: anything else (a winner became a split, the lean moved, ...).
 */
export function appealOutcome(
  prev: Pick<VerdictResult, "verdict" | "lean">,
  next: Pick<VerdictResult, "verdict" | "lean">,
): AppealOutcome {
  if (win(prev.verdict) && win(next.verdict) && prev.verdict !== next.verdict) return "overturned";
  if (
    prev.verdict === next.verdict &&
    (win(prev.verdict) || (prev.lean?.party ?? null) === (next.lean?.party ?? null))
  ) {
    return "upheld";
  }
  return "changed";
}

export function confidenceChange(prev: Pick<VerdictResult, "confidence">, next: Pick<VerdictResult, "confidence">): number {
  return next.confidence - prev.confidence;
}
