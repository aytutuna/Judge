import type { ClaimKind } from "./types";

/**
 * Timeline for the "thinking dig" judging animation. Pure functions only:
 * no React, no DOM, so the state machine is unit-testable in node.
 *
 * Loop mode plays the judge's method as a ~15s story on repeat until the
 * verdict arrives; finish mode is a short, bounded sequence that drops the
 * beats already shown and hands off to the verdict page.
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

export const LABEL_STEP = 1;
export const FIRST_POP_STEP = 2;
export const ROWS = 3;
export const BEDROCK_STEP = 5;
export const CRUX_STEP = 6;
export const JUDGES_STEP = 7;
export const VOTES_STEP = 8;

export const FINISH_STEPS: readonly { name: "settle" | "sweep" | "crux" | "out"; ms: number }[] = [
  { name: "settle", ms: 600 },
  { name: "sweep", ms: 900 },
  { name: "crux", ms: 700 },
  { name: "out", ms: 250 },
];

export const SWEEP_STAGGER_MS = 250;
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

/** Which side pops first in a row — alternates by row and flips each cycle. */
export function firstSide(row: number, cycle: number): "a" | "b" {
  return (row + cycle) % 2 === 0 ? "a" : "b";
}

const KINDS: readonly ClaimKind[] = ["fact", "value", "definition", "logic"];

/** Kind tags per row; B mirrors A so both columns carry the same multiset. */
export function kindsFor(cycle: number): { a: ClaimKind[]; b: ClaimKind[] } {
  const c = ((cycle % 4) + 4) % 4;
  const a = [KINDS[c], KINDS[(c + 1) % 4], KINDS[(c + 2) % 4]];
  return { a, b: [...a].reverse() };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Pop of row `depth` and draw of bore segment `depth`. null = not yet. */
export function popPlan(
  depth: number,
  state: DigState,
): { delayMs: number; fast: boolean } | null {
  if (state.mode === "loop") {
    return depth <= state.step - FIRST_POP_STEP ? { delayMs: 0, fast: false } : null;
  }
  const poppedInLoop = clamp(state.from - FIRST_POP_STEP + 1, 0, ROWS);
  if (depth < poppedInLoop) return { delayMs: 0, fast: false };
  if (state.step >= 1) return { delayMs: (depth - poppedInLoop) * SWEEP_STAGGER_MS, fast: true };
  return null;
}

export function sceneFlags(state: DigState): {
  tagsOn: boolean;
  bedrockLit: boolean;
  cruxLit: boolean;
  fastCrux: boolean;
  judgesIn: boolean;
  votesIn: boolean;
  fadeOut: boolean;
} {
  if (state.mode === "loop") {
    return {
      tagsOn: state.step >= LABEL_STEP,
      bedrockLit: state.step >= BEDROCK_STEP,
      cruxLit: state.step >= CRUX_STEP,
      fastCrux: false,
      judgesIn: state.step >= JUDGES_STEP,
      votesIn: state.step >= VOTES_STEP,
      fadeOut: false,
    };
  }
  return {
    tagsOn: true,
    bedrockLit: state.step >= 2,
    cruxLit: state.step >= 2,
    fastCrux: state.from < CRUX_STEP,
    judgesIn: state.from >= JUDGES_STEP,
    votesIn: state.from >= VOTES_STEP,
    fadeOut: state.step === 3,
  };
}

/** Visible caption. */
export function caption(state: DigState): string {
  if (state.mode === "loop") return THINKING_STEPS[state.step].caption;
  return state.from >= CRUX_STEP ? THINKING_STEPS[state.from].caption : FINISH_CAPTION;
}

/** Text for the polite live region. */
export function announcement(state: DigState, done: boolean): string {
  if (done || state.mode === "finish") return READY;
  return state.cycle === 0 ? THINKING_STEPS[state.step].caption : STILL_JUDGING;
}
