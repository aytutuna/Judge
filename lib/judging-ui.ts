import type { Key } from "./i18n";
import { sceneVerdictFrom } from "./balance";
import type { JudgingBeat, Vote } from "./scene-bridge";
import type { DigState } from "./thinking";
import type { VerdictResult } from "./types";

/**
 * Pure view logic of the judging overlay: which checklist row is active,
 * how full the progress bar is, which 3D beat to show and how to colour the
 * judge dots. lib/thinking.ts still owns every timing decision.
 */

/** Hold after the finish sequence so the coloured votes and the tilt read
 * before the verdict card replaces the overlay (0 under reduced motion).
 * Worst case 2450 + 900 ms stays inside the page's 5000 ms safety net. */
export const REVEAL_HOLD_MS = 900;

/** The six checklist rows, in order. */
export const CHECKLIST_KEYS = [
  "thinking.read",
  "thinking.label",
  "thinking.dig",
  "thinking.crux",
  "thinking.judges",
  "thinking.votes",
] as const satisfies readonly Key[];

/** Loop step (lib/thinking.ts THINKING_STEPS index) → checklist row. */
export const STEP_TO_ROW: readonly number[] = [0, 1, 2, 2, 2, 2, 3, 4, 5];

const JUDGES_ROW = 4;

export type RowStatus = "pending" | "active" | "done";

export function checklistState(
  state: DigState,
  done: boolean,
): { rows: RowStatus[]; stillJudging: boolean; ready: boolean } {
  const n = CHECKLIST_KEYS.length;
  if (done || state.mode === "finish") {
    return { rows: Array<RowStatus>(n).fill("done"), stillJudging: false, ready: true };
  }
  if (state.cycle >= 1) {
    // The story is told once; later cycles just say the judges are still out.
    const rows = Array.from({ length: n }, (_, i): RowStatus =>
      i < JUDGES_ROW ? "done" : i === JUDGES_ROW ? "active" : "pending",
    );
    return { rows, stillJudging: true, ready: false };
  }
  const active = STEP_TO_ROW[state.step] ?? 0;
  const rows = Array.from({ length: n }, (_, i): RowStatus =>
    i < active ? "done" : i === active ? "active" : "pending",
  );
  return { rows, stillJudging: false, ready: false };
}

/** Progress bar fill. Eases toward 92% (about .62 at 10 s, .82 at 20 s, .89
 * at 30 s) so it never reaches the end before the answer and never visibly
 * stalls; jumps to 1 once the answer is in. */
export function progressAt(elapsedMs: number, done: boolean): number {
  if (done) return 1;
  return 0.92 * (1 - Math.exp(-Math.max(0, elapsedMs) / 9000));
}

/** 3D beat for a judging state. Later cycles deliberate instead of
 * replaying the colour-free fragment story or faking votes. */
export function judgingBeatFor(state: DigState): JudgingBeat {
  if (state.mode === "finish") return "orbs";
  if (state.cycle >= 1) return "deliberate";
  const s = state.step;
  if (s <= 0) return "lift";
  if (s === 1) return "sort";
  if (s <= 5) return "dig";
  if (s === 6) return "crux";
  return "orbs";
}

export type JudgeDot = Vote | "pending";

/** The judge dots: three neutral ones while waiting, then one per run (more
 * than three after an escalation), coloured by what that run concluded. A
 * refusal keeps three neutral dots: no judge ruled. */
export function judgeDots(result: VerdictResult | null, done: boolean): JudgeDot[] {
  const pending: JudgeDot[] = ["pending", "pending", "pending"];
  if (!done || !result) return pending;
  const votes = sceneVerdictFrom(result).votes;
  return votes.length > 0 ? [...votes] : pending;
}

/** Premium's extra line above the checklist: the web fact-check runs before
 * the judges, so it reads as in progress until the verdict is in. */
export function premiumCaptionKey(done: boolean): Key {
  return done ? "thinking.factcheckDone" : "thinking.factcheck";
}
