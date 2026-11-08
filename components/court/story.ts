// What the judging card says and shows while it waits. The browser only hears
// two things from the server: that the names are out (the 202) and that the
// verdict is in, so everything between is paced by the clock. The order is
// the server's real order (lib/premium/run.ts); only the timing is guessed.
// Pure: the apps port this file and check themselves against
// mobile/shared/fixtures/story-vectors.json.

import { sceneVerdictFrom, type Vote } from "@/lib/balance";
import type { CruxTrialOutcome, VerdictResult } from "@/lib/types";

export const WAITING = ["names", "facts", "judges", "bothSides", "crux", "ruling"] as const;
export type Waiting = (typeof WAITING)[number];
export type Beat = Waiting | "vote1" | "more" | "vote2" | "trial" | "final";

// How long each line holds once the names are out. The last one waits for
// the verdict however long it takes.
const HOLD: Record<Exclude<Waiting, "names" | "ruling">, number> = {
  facts: 9000,
  judges: 6000,
  bothSides: 7000,
  crux: 7000,
};

/** Names stay up at least this long, so the first line can be read. */
export const NAMES_MIN_MS = 2500;

// Once the verdict is in, the lines still to come go by at this pace.
export const CATCH_UP_MS = 450;
export const VOTE_MS = 420;
/** The cross-examination: objection, then the adjudicator's answer. */
export const TRIAL_MS = 4200;

/** The longest the card plays on after the verdict lands (from the first line, a close call with five votes and a trial). */
export const ENDING_MAX_MS = 16000;

/** The line being worked on `elapsed` ms in, given when the 202 came (null: not yet). */
export function waitingAt(elapsed: number, acceptedAt: number | null): number {
  if (acceptedAt === null) return 0;
  let t = Math.max(NAMES_MIN_MS, acceptedAt);
  if (elapsed < t) return 0;
  for (let i = 1; i < WAITING.length - 1; i++) {
    t += HOLD[WAITING[i] as keyof typeof HOLD];
    if (elapsed < t) return i;
  }
  return WAITING.length - 1;
}

/** The most common vote and how many judges gave it; no side unless it's more than half. */
export function agreement(votes: readonly string[]): { side: string | null; n: number } {
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  let side: string | null = null;
  let n = 0;
  for (const [v, c] of counts) {
    if (c > n) [side, n] = [v, c];
    else if (c === n) side = null;
  }
  return { side: n * 2 > votes.length ? side : null, n };
}

/** What the ending needs to know about the verdict. */
export type Summary = {
  votes: readonly Vote[];
  escalated: boolean;
  /** Judges called in for a close one; the first round is the usual three. */
  extra: number;
  winner: "a" | "b" | null;
  trial: CruxTrialOutcome | null;
};

export function summarize(result: VerdictResult): Summary {
  const { votes } = sceneVerdictFrom(result);
  const escalated = !!result.escalated;
  const winner = result.verdict === "side_a" ? "a" : result.verdict === "side_b" ? "b" : null;
  return {
    votes,
    escalated,
    extra: escalated ? Math.max(0, votes.length - 3) : 0,
    winner,
    trial: result.crux_trial?.outcome ?? null,
  };
}

export type LineKey =
  | `story.${Waiting}`
  | "story.count"
  | "story.closeCall"
  | "story.agree"
  | "story.split"
  | "trial.survived"
  | "trial.uncertain"
  | "trial.overturned"
  | "thinking.ready";

/** A log line. The trial lines are shown without their leading emoji (lib/text stripLeadingEmoji). */
export type Line = { key: LineKey; vars?: { n: number; total: number } };

/** At `at` ms after the verdict lands, the court moves to `beat` and the log gains `line` (if any). */
export type Step = { at: number; beat: Beat; line: Line | null };
export type Ending = { steps: Step[]; finishAt: number };

/**
 * Everything that happens once the verdict lands, given the waiting line the
 * story was on. Without a summary (no result) or with reduced motion the
 * card just hands off.
 */
export function ending(fromWaiting: number, summary: Summary | null, reduced: boolean): Ending {
  if (reduced || !summary) return { steps: [], finishAt: reduced ? 600 : 0 };
  const { votes, escalated, extra, trial } = summary;
  const steps: Step[] = [];
  let at = 0;
  const later = (ms: number, beat: Beat, line: Line | null) => {
    at += ms;
    steps.push({ at, beat, line });
  };
  for (let i = fromWaiting + 1; i < WAITING.length; i++) {
    later(i === fromWaiting + 1 ? 0 : CATCH_UP_MS, WAITING[i], { key: `story.${WAITING[i]}` });
  }
  // A refusal has no votes to count, so it skips straight to the end.
  if (votes.length) {
    later(CATCH_UP_MS, "vote1", { key: "story.count" });
    at += 1200 + Math.min(3, votes.length) * VOTE_MS;
  }
  if (escalated) {
    later(400, "more", { key: "story.closeCall" });
    if (extra > 0) {
      later(2600, "vote2", null);
      at += Math.min(2, extra) * VOTE_MS;
    }
  }
  if (votes.length && trial) {
    later(600, "trial", { key: `trial.${trial}` });
    at += TRIAL_MS;
  }
  const { side, n } = agreement(votes);
  at += 600;
  if (votes.length) steps.push({ at, beat: "final", line: side ? { key: "story.agree", vars: { n, total: votes.length } } : { key: "story.split" } });
  steps.push({ at, beat: "final", line: { key: "thinking.ready" } });
  return { steps, finishAt: at + 1900 };
}
