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

/** The stamp on the verdict card: the winner as verdictLabel says it,
 * otherwise one short word. */
export function stampLabel(
  r: VerdictResult,
  nameA: string,
  nameB: string,
  aIsSelf: boolean,
  bIsSelf: boolean,
  lang: Lang,
): string {
  switch (r.verdict) {
    case "side_a":
    case "side_b":
      return verdictLabel(r, nameA, nameB, aIsSelf, bIsSelf, lang);
    case "split":
      return t(lang, "stamp.split");
    case "conditional":
      return t(lang, "stamp.conditional");
    case "dissolved":
      return t(lang, "stamp.dissolved");
    case "too_close":
      return t(lang, "stamp.tooClose");
  }
}

/** How many judge runs reached the final verdict. Null when there is no
 * majority ruling to agree with (too close) or no runs at all. */
export function agreement(r: VerdictResult): { n: number; total: number } | null {
  if (!r.runs.length || r.verdict === "too_close") return null;
  return { n: r.runs.filter((v) => v === r.verdict).length, total: r.runs.length };
}

/** The confidence shown to users: how many judges voted the final verdict,
 * on the panel's own scale ("Confidence 4 of 5" after an escalation). The
 * stored 1-5 score stays internal. Null for a refusal (no runs). */
export function confidenceLabel(lang: Lang, r: VerdictResult): string | null {
  if (!r.runs.length) return null;
  const a = agreement(r);
  return a ? t(lang, "confidence", a) : t(lang, "verdict.noMajority");
}

/** The judges' name in a thread: plain until there is a verdict, then how
 * far they agreed. */
export function judgesLabel(lang: Lang, r: VerdictResult | null): string {
  if (!r?.runs.length) return t(lang, "thread.judges");
  const a = agreement(r);
  return a ? t(lang, "thread.judgesAgree", a) : t(lang, "thread.judgesSplit");
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

/** Who sat on a premium panel, e.g. "Judges: 2 strong + 1 quick". `models`
 * is VerdictResult.panel.models (one entry per counted run, escalation
 * included). Users see seat tiers, never model names: the lite model is
 * "quick", every other model is "strong". */
export function panelSummary(models: readonly string[], lang: Lang): string {
  const quick = models.filter((m) => /haiku/i.test(m)).length;
  const strong = models.length - quick;
  const parts: string[] = [];
  if (strong) parts.push(t(lang, "panel.strong", { n: strong }));
  if (quick) parts.push(t(lang, "panel.quick", { n: quick }));
  return t(lang, "panel.models", { list: parts.join(" + ") });
}
