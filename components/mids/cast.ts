// The Mids' little actor system: plain state plus timers, no React, so the
// scripts read as straight-line async code and tests can drive it with fake
// timers. Positions are 0..1 of the stage, y being where the feet touch.

export type Arms =
  | "rest"
  | "wave"
  | "up"
  | "hold"
  | "chin"
  | "shrug"
  | "point"
  | "stretch"
  | "write"
  | "clap"
  | "high"
  | "vote"
  | "beam";
export type Eyes = "open" | "down" | "happy" | "closed" | "wide" | "squint";
export type Prop = "paper" | "glass" | "pad" | "book" | "flag-a" | "flag-b" | "flag-o" | null;
export type Bubble = "talk" | "think" | "idea" | "sleep" | "note" | "dots" | null;
export type Motion = "stand" | "walk" | "run" | "hop" | "nod" | "sit" | "dance" | "spin" | "bounce" | "shake" | "lean";

export type Mid = {
  x: number;
  y: number;
  face: 1 | -1;
  arms: Arms;
  eyes: Eyes;
  prop: Prop;
  bubble: Bubble;
  motion: Motion;
  /** Where the eyes point, -1..1 each way. */
  look: [number, number];
  /** How long the current move takes, ms. */
  t: number;
};

export const REST: Omit<Mid, "x" | "y" | "face"> = {
  arms: "rest",
  eyes: "open",
  prop: null,
  bubble: null,
  motion: "stand",
  look: [0, 0],
  t: 0,
};

export function mid(x: number, y: number, face: 1 | -1 = 1): Mid {
  return { ...REST, x, y, face };
}

// Walking pace in px/s; the stage size turns it into a duration.
const WALK = 75;
const RUN = 170;

export class Cast {
  mids: Mid[];
  w = 360;
  h = 240;
  reduced = false;
  private gens: number[];
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private onChange: (mids: Mid[]) => void;

  constructor(mids: Mid[], onChange: (mids: Mid[]) => void) {
    this.mids = mids;
    this.gens = mids.map(() => 0);
    this.onChange = onChange;
  }

  setReduced(on: boolean): void {
    this.reduced = on;
  }

  get size(): number {
    return this.mids.length;
  }

  add(m: Mid): number {
    this.mids = [...this.mids, m];
    this.gens.push(0);
    this.onChange(this.mids);
    return this.mids.length - 1;
  }

  set(i: number, patch: Partial<Mid>): void {
    this.mids = this.mids.map((m, j) => (j === i ? { ...m, ...patch } : m));
    this.onChange(this.mids);
  }

  /** Starts a fresh run for these mids; older runs on them go quiet. */
  claim(ids: number[]): number[] {
    return ids.map((i) => ++this.gens[i]);
  }

  alive(ids: number[], tokens: number[]): boolean {
    return ids.every((i, k) => this.gens[i] === tokens[k]);
  }

  /** Resolves after ms, or never if any of the mids was claimed since. */
  wait(ms: number, ids: number[], tokens: number[]): Promise<void> {
    return new Promise((resolve) => {
      const id = setTimeout(() => {
        this.timers.delete(id);
        if (this.alive(ids, tokens)) resolve();
      }, ms);
      this.timers.add(id);
    });
  }

  /** How long a walk from where the mid is to (x, y) takes. */
  travel(i: number, x: number, y: number, run = false): number {
    const m = this.mids[i];
    const px = Math.hypot((x - m.x) * this.w, (y - m.y) * this.h);
    return this.reduced ? 0 : Math.round((px / (run ? RUN : WALK)) * 1000);
  }

  /** Sets off and arrives; the mid faces the way it goes. */
  async go(i: number, x: number, y: number, ids: number[], tokens: number[], run = false): Promise<void> {
    const m = this.mids[i];
    const t = this.travel(i, x, y, run);
    if (t < 60) {
      this.set(i, { x, y, t: 0 });
      return;
    }
    const face = Math.abs(x - m.x) < 0.01 ? m.face : x < m.x ? -1 : 1;
    this.set(i, { x, y, t, face, motion: run ? "run" : "walk", bubble: m.bubble === "note" ? "note" : null });
    await this.wait(t, ids, tokens);
    this.set(i, { motion: "stand" });
  }

  stop(): void {
    this.gens = this.gens.map((g) => g + 1);
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }
}

/** A run of a script over some mids: their token set and short helpers. */
export function run(cast: Cast, ids: number[]) {
  const tokens = cast.claim(ids);
  return {
    cast,
    ids,
    alive: () => cast.alive(ids, tokens),
    wait: (ms: number) => cast.wait(cast.reduced ? Math.max(ms, 1200) : ms, ids, tokens),
    go: (i: number, x: number, y: number, fast = false) => cast.go(i, x, y, ids, tokens, fast),
    set: (i: number, patch: Partial<Mid>) => cast.set(i, patch),
    face: (i: number, toward: number) => cast.set(i, { face: toward < cast.mids[i].x ? -1 : 1 }),
  };
}

export type Run = ReturnType<typeof run>;

export function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function weighted<T>(items: readonly (readonly [T, number])[]): T {
  let r = Math.random() * items.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}

/** Seats in a row, evenly spread, for n mids. */
export function seats(n: number, y = 0.86): [number, number][] {
  const span = Math.min(0.76, 0.26 * (n - 1));
  return Array.from({ length: n }, (_, i) => [n === 1 ? 0.5 : 0.5 - span / 2 + (span * i) / (n - 1), y]);
}

/** The side most votes went to, or null on a tie or no votes. */
export function majority(votes: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let top = 0;
  for (const [v, c] of counts) {
    if (c > top) [best, top] = [v, c];
    else if (c === top) best = null;
  }
  return best;
}
