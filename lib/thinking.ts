/**
 * Timeline for the judging overlay (components/JudgingOverlay.tsx) and the
 * scene beats it drives. Pure functions only: no React, no DOM, so the
 * state machine is unit-testable in node.
 *
 * Loop mode plays the judge's method as a ~15s story on repeat until the
 * verdict arrives; finish mode is a short, bounded sequence that hands off
 * to the verdict. lib/judging-ui.ts maps these states to the checklist,
 * progress bar and scene beats; lib/thinking-keys.ts maps the captions to
 * dictionary keys.
 */

export const THINKING_STEPS: readonly { caption: string; ms: number }[] = [
  { caption: "Reading and steelmanning both sides…", ms: 2400 },
  { caption: "Labeling claims: fact, value, definition, logic…", ms: 2400 },
  { caption: "Digging down to bedrock…", ms: 1100 },
  { caption: "Digging down to bedrock…", ms: 1100 },
  { caption: "Digging down to bedrock…", ms: 1100 },
  { caption: "Reaching each side's bedrock…", ms: 1300 },
  { caption: "Locating the crux…", ms: 2400 },
  { caption: "Three independent judges deliberating…", ms: 2400 },
  { caption: "Counting the votes…", ms: 1200 },
];

export const FINISH_STEPS: readonly { name: "settle" | "sweep" | "crux" | "out"; ms: number }[] = [
  { name: "settle", ms: 600 },
  { name: "sweep", ms: 900 },
  { name: "crux", ms: 700 },
  { name: "out", ms: 250 },
];

export const MAX_FINISH_MS = 3000;
export const FINISH_CAPTION = "Digging to the crux…";
export const STILL_JUDGING = "Still judging — three AI judges rule one at a time…";
export const READY = "Verdict ready.";

export type DigState =
  | { mode: "loop"; step: number; cycle: number }
  /** `from` = the loop step the response landed on. */
  | { mode: "finish"; step: number; from: number; cycle: number };

export const INITIAL_STATE: DigState = { mode: "loop", step: 0, cycle: 0 };

/** Which finish step to enter from a given loop step. */
export function finishEntry(fromLoopStep: number): number {
  if (fromLoopStep <= 1) return 0;
  if (fromLoopStep <= 3) return 1;
  if (fromLoopStep <= 5) return 2;
  return 3;
}

/** The single transition function. `skip` = reduced motion or hidden tab. */
export function plan(
  state: DigState,
  done: boolean,
  skip: boolean,
): { to: DigState | "finish"; delayMs: number } {
  if (state.mode === "loop") {
    if (done) {
      if (skip) return { to: "finish", delayMs: 0 };
      return {
        to: { mode: "finish", step: finishEntry(state.step), from: state.step, cycle: state.cycle },
        delayMs: 0,
      };
    }
    const last = state.step >= THINKING_STEPS.length - 1;
    return {
      to: last
        ? { mode: "loop", step: 0, cycle: state.cycle + 1 }
        : { mode: "loop", step: state.step + 1, cycle: state.cycle },
      delayMs: THINKING_STEPS[state.step].ms,
    };
  }
  const delayMs = FINISH_STEPS[state.step].ms;
  if (state.step >= FINISH_STEPS.length - 1) return { to: "finish", delayMs };
  return { to: { ...state, step: state.step + 1 }, delayMs };
}

/** Text for the polite live region. */
export function announcement(state: DigState, done: boolean): string {
  if (done || state.mode === "finish") return READY;
  return state.cycle === 0 ? THINKING_STEPS[state.step].caption : STILL_JUDGING;
}
