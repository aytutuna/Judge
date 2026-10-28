import type { Party } from "./palette";

/**
 * The one channel between the page and the 3D balance. Pure TS (no three):
 * the page, the hero, the story and the judging overlay write here, the
 * render loop reads here, so neither side imports the other and three.js
 * stays in its lazy chunk.
 *
 * Two kinds of state:
 * - discrete (mode, status, story step): subscribable, consumed by React
 *   through the hooks in lib/scene-bridge-react.ts;
 * - continuous (pointer, scroll progress, impulses): plain mutable objects
 *   the render loop polls every frame, so typing and scrolling cost zero
 *   React renders and zero allocation.
 */

export type Vote = "a" | "b" | "other";
export type JudgingBeat = "lift" | "sort" | "dig" | "crux" | "orbs" | "deliberate";
export type SceneVerdict = { tugA: number; votes: readonly Vote[] };
export type SceneMode =
  | { kind: "idle" }
  | { kind: "judging"; beat: JudgingBeat }
  | { kind: "verdict"; verdict: SceneVerdict };
export type SceneStatus = "loading" | "ready" | "fallback";

const IDLE: SceneMode = { kind: "idle" };

let mode: SceneMode = IDLE;
let you: Party | null = null;
let status: SceneStatus = "loading";
let storyStep = -1;

const modeListeners = new Set<() => void>();
const statusListeners = new Set<() => void>();
const stepListeners = new Set<() => void>();
const inputListeners = new Set<() => void>();

function emit(set: Set<() => void>): void {
  for (const fn of set) fn();
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/* ---------- continuous (polled) ---------- */

/** Written by the page, read by the render loop each frame. */
export const sceneInput = {
  /** Pointer, -1..1 across the viewport (fine pointers only). */
  px: 0,
  py: 0,
  /** Story progress: step i is active when round(q) === i; below -0.7 is the hero. */
  q: -3,
  /** Angular kick (rad/s) the loop consumes and zeroes. */
  impulse: 0,
  /** 0..1 excitement from typing; the loop decays it. */
  energy: 0,
  /** performance.now() of the last user input, for the idle-sway timeout. */
  lastInputAt: 0,
};

/** Written by the engine each frame, read by the DOM side. */
export const sceneOutput: {
  /** Projected bounding box of the balance, CSS px relative to the canvas. */
  contentRect: { top: number; right: number; bottom: number; left: number } | null;
  /** True once every animated value has converged and nothing moves. */
  settled: boolean;
} = { contentRect: null, settled: false };

/** Called on every continuous input (typing, pointer, story scroll). A
 * render loop that stopped once the scene settled uses it to wake up. */
export function subscribeSceneInput(fn: () => void): () => void {
  inputListeners.add(fn);
  return () => {
    inputListeners.delete(fn);
  };
}

/** Typing gives a small random kick; an example chip a big signed one. */
export function nudgeScene(source: "type" | "example", sign?: -1 | 1): void {
  if (source === "example") {
    sceneInput.impulse += (sign ?? 1) * 2.2;
    sceneInput.energy = 1;
  } else {
    const dir = sign ?? (Math.random() < 0.5 ? -1 : 1);
    sceneInput.impulse += dir * (0.35 + Math.random() * 0.35);
    sceneInput.energy = Math.min(1, sceneInput.energy + 0.25);
  }
  sceneInput.lastInputAt = now();
  emit(inputListeners);
}

/** -1..1 across the viewport. */
export function setPointer(nx: number, ny: number): void {
  sceneInput.px = Math.max(-1, Math.min(1, nx));
  sceneInput.py = Math.max(-1, Math.min(1, ny));
  sceneInput.lastInputAt = now();
  emit(inputListeners);
}

/** Snapped story step: -1 in the hero, else 0..4. */
export function storyStepOf(q: number): number {
  if (q < -0.5) return -1;
  return Math.max(0, Math.min(4, Math.round(q)));
}

/** Called by ScrollStory from a rAF-throttled scroll handler. Notifies step
 * subscribers only when the snapped step changes (the reduced-motion path
 * renders one frame per step). */
export function setStoryProgress(q: number): void {
  // Scrolling the story counts as input: it keeps ambient motion alive.
  const moved = q !== sceneInput.q;
  if (moved) sceneInput.lastInputAt = now();
  sceneInput.q = q;
  const step = storyStepOf(q);
  if (step !== storyStep) {
    storyStep = step;
    emit(stepListeners);
  }
  if (moved) emit(inputListeners);
}

export function getStoryStep(): number {
  return storyStep;
}

export function subscribeStoryStep(fn: () => void): () => void {
  stepListeners.add(fn);
  return () => {
    stepListeners.delete(fn);
  };
}

/* ---------- discrete (subscribable) ---------- */

export function getSceneMode(): SceneMode {
  return mode;
}

export function setSceneMode(m: SceneMode): void {
  if (sameMode(mode, m)) return;
  mode = m;
  emit(modeListeners);
}

function sameMode(a: SceneMode, b: SceneMode): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "judging" && b.kind === "judging") return a.beat === b.beat;
  if (a.kind === "verdict" && b.kind === "verdict") {
    return (
      a.verdict.tugA === b.verdict.tugA &&
      a.verdict.votes.length === b.verdict.votes.length &&
      a.verdict.votes.every((v, i) => v === b.verdict.votes[i])
    );
  }
  return true;
}

export function subscribeScene(fn: () => void): () => void {
  modeListeners.add(fn);
  return () => {
    modeListeners.delete(fn);
  };
}

export function getSceneYou(): Party | null {
  return you;
}

/** The viewer's party: their sphere and votes are drawn green, the other
 * side's red (sideColors in lib/palette.ts). null, the default, draws Party
 * A green: the writer of a one-person verdict, or nobody known. Whoever
 * shows the scene sets it and clears it when done; resetScene leaves it
 * alone. Mode subscribers hear the change. */
export function setSceneYou(p: Party | null): void {
  if (p === you) return;
  you = p;
  emit(modeListeners);
}

export function getSceneStatus(): SceneStatus {
  return status;
}

export function setSceneStatus(s: SceneStatus): void {
  if (s === status) return;
  status = s;
  emit(statusListeners);
}

export function subscribeSceneStatus(fn: () => void): () => void {
  statusListeners.add(fn);
  return () => {
    statusListeners.delete(fn);
  };
}

/** Back to idle with no pending motion (page reset, judging error). */
export function resetScene(): void {
  sceneInput.impulse = 0;
  sceneInput.energy = 0;
  setSceneMode(IDLE);
}
