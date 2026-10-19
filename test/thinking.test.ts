import { describe, expect, it } from "vitest";
import {
  FINISH_CAPTION,
  FINISH_STEPS,
  INITIAL_STATE,
  MAX_FINISH_MS,
  READY,
  STILL_JUDGING,
  THINKING_STEPS,
  announcement,
  finishEntry,
  plan,
  type DigState,
} from "../lib/thinking";

const loop = (step: number, cycle = 0): DigState => ({ mode: "loop", step, cycle });
const finish = (step: number, from: number, cycle = 0): DigState => ({
  mode: "finish",
  step,
  from,
  cycle,
});
const LOOP_STEPS = THINKING_STEPS.map((_, i) => i);

describe("timeline tables", () => {
  it("loop captions are non-empty, progressive (end with …) and timed", () => {
    for (const s of THINKING_STEPS) {
      expect(s.caption.length).toBeGreaterThan(0);
      expect(s.caption.endsWith("…")).toBe(true);
      expect(s.ms).toBeGreaterThan(0);
    }
    for (const f of FINISH_STEPS) expect(f.ms).toBeGreaterThan(0);
    expect(FINISH_STEPS.map((f) => f.name)).toEqual(["settle", "sweep", "crux", "out"]);
  });

  it("constants are in range", () => {
    expect(THINKING_STEPS.length).toBe(9);
    expect(FINISH_STEPS.reduce((n, f) => n + f.ms, 0)).toBeLessThanOrEqual(MAX_FINISH_MS);
    expect(FINISH_CAPTION.endsWith("…")).toBe(true);
  });

  it("caption-bearing loop steps are readable (>= 1300ms)", () => {
    // read, label, reach bedrock, crux, judges (the dig steps share a caption)
    for (const step of [0, 1, 5, 6, 7]) {
      expect(THINKING_STEPS[step].ms).toBeGreaterThanOrEqual(1300);
    }
  });

  it("loop total is 14–17s", () => {
    const total = THINKING_STEPS.reduce((n, s) => n + s.ms, 0);
    expect(total).toBeGreaterThanOrEqual(14000);
    expect(total).toBeLessThanOrEqual(17000);
  });
});

describe("plan — loop mode", () => {
  it("advances one step with that step's duration", () => {
    for (const step of LOOP_STEPS.slice(0, -1)) {
      expect(plan(loop(step, 3), false, false)).toEqual({
        to: loop(step + 1, 3),
        delayMs: THINKING_STEPS[step].ms,
      });
    }
  });

  it("wraps the last step to step 0 of the next cycle", () => {
    const last = THINKING_STEPS.length - 1;
    expect(plan(loop(last, 2), false, false)).toEqual({
      to: loop(0, 3),
      delayMs: THINKING_STEPS[last].ms,
    });
    expect(plan(INITIAL_STATE, false, false).to).toEqual(loop(1, 0));
  });

  it("done + skip finishes on the next tick from every loop step", () => {
    for (const step of LOOP_STEPS) {
      expect(plan(loop(step, 1), true, true)).toEqual({ to: "finish", delayMs: 0 });
    }
  });

  it("done enters finish mode immediately at finishEntry(step) with from = step", () => {
    for (const step of LOOP_STEPS) {
      expect(plan(loop(step, 4), true, false)).toEqual({
        to: finish(finishEntry(step), step, 4),
        delayMs: 0,
      });
    }
  });

  it("finishEntry table: 0–1→0, 2–3→1, 4–5→2, ≥6→3", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(finishEntry)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 3]);
  });
});

describe("plan — finish mode", () => {
  it("never returns to loop mode regardless of done, and reaches finish", () => {
    for (const done of [true, false]) {
      for (const from of LOOP_STEPS) {
        let s: DigState = finish(finishEntry(from), from);
        let guard = 0;
        for (;;) {
          const { to, delayMs } = plan(s, done, false);
          expect(delayMs).toBe(FINISH_STEPS[s.step].ms);
          if (to === "finish") break;
          expect(to.mode).toBe("finish");
          s = to;
          expect(++guard).toBeLessThan(10);
        }
      }
    }
  });

  it("walks settle → sweep → crux → out → finish", () => {
    const seq: (DigState | "finish")[] = [];
    let s: DigState | "finish" = finish(0, 0);
    while (s !== "finish") {
      s = plan(s, true, false).to;
      seq.push(s);
    }
    expect(seq).toEqual([finish(1, 0), finish(2, 0), finish(3, 0), "finish"]);
  });

  it("bound: from any state, done=true reaches finish within 6 transitions and MAX_FINISH_MS", () => {
    const starts: DigState[] = [];
    for (const cycle of [0, 1, 5]) {
      for (const step of LOOP_STEPS) starts.push(loop(step, cycle));
    }
    for (const from of LOOP_STEPS) {
      for (let step = finishEntry(from); step < FINISH_STEPS.length; step++) {
        starts.push(finish(step, from));
      }
    }
    for (const start of starts) {
      let s: DigState | "finish" = start;
      let transitions = 0;
      let total = 0;
      while (s !== "finish") {
        const { to, delayMs } = plan(s, true, false);
        total += delayMs;
        s = to;
        transitions++;
        expect(transitions).toBeLessThanOrEqual(6);
      }
      expect(total).toBeLessThanOrEqual(MAX_FINISH_MS);
    }
  });
});

describe("announcement", () => {
  it("announcement: cycle 0 → caption, cycle ≥ 1 → STILL_JUDGING", () => {
    for (const step of LOOP_STEPS) {
      expect(announcement(loop(step, 0), false)).toBe(THINKING_STEPS[step].caption);
      expect(announcement(loop(step, 1), false)).toBe(STILL_JUDGING);
      expect(announcement(loop(step, 4), false)).toBe(STILL_JUDGING);
    }
  });

  it("announcement: done or finish mode → READY", () => {
    for (const step of LOOP_STEPS) {
      expect(announcement(loop(step, 0), true)).toBe(READY);
      expect(announcement(loop(step, 3), true)).toBe(READY);
      const f = finish(finishEntry(step), step);
      expect(announcement(f, true)).toBe(READY);
      expect(announcement(f, false)).toBe(READY);
    }
  });
});
