import { t, type Lang } from "./i18n";
import type { Lean, VerdictResult } from "./types";

/**
 * Display helpers shared by the verdict card, the share page, the OG image
 * and the 3D scene. Pure module (no React, no "use client").
 */

/** The self flags are the structural second-person trigger — never a
 * string test on the display name (which cannot see "Sen", and
 * default-locale toLowerCase corrupts Turkish names). */
export function verdictLabel(
  r: VerdictResult,
  nameA: string,
  nameB: string,
  aIsSelf: boolean,
  bIsSelf: boolean,
  lang: Lang,
): string {
  switch (r.verdict) {
    case "side_a":
      return aIsSelf ? t(lang, "verdict.winSelf") : t(lang, "verdict.win", { name: nameA });
    case "side_b":
      return bIsSelf ? t(lang, "verdict.winSelf") : t(lang, "verdict.win", { name: nameB });
    case "split":
      return t(lang, "verdict.split");
    case "conditional":
      return t(lang, "verdict.conditional");
    case "dissolved":
      return t(lang, "verdict.dissolved");
    case "too_close":
      return t(lang, "verdict.tooClose");
  }
}

/** Final divider position of the tug-of-war bar (Party A's share, %).
 * A forced-ruling lean nudges the bar to a single fixed 62/38 — visibly
 * off-center yet clearly milder than the 80/20 win, so "more right, not
 * completely" reads at a glance. Deliberately NOT agreement-graded: with one
 * surviving run "unanimous" is vacuous and a stronger bar would overclaim;
 * the agreement note carries that distinction in text. */
export function tugFinal(result: VerdictResult): number {
  switch (result.verdict) {
    case "side_a":
      return 80;
    case "side_b":
      return 20;
    default:
      if (result.lean) return result.lean.party === "a" ? 62 : 38;
      return 50;
  }
}

/** Forced-vote split for a non-unanimous lean. aggregate stores the tally
 * only when the run count does not imply it: without one, the only possible
 * split is (runs - 1)–1 (a 2–1 on every pre-escalation row). */
export function leanTally(lean: Lean, runCount: number): { for: number; against: number } {
  return lean.tally ?? { for: runCount - 1, against: 1 };
}
