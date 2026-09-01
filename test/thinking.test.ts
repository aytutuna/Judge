import { describe, expect, it } from "vitest";
import {
  BEDROCK_STEP,
  CRUX_STEP,
  FINISH_CAPTION,
  FINISH_STEPS,
  FIRST_POP_STEP,
  INITIAL_STATE,
  JUDGES_STEP,
  LABEL_STEP,
  MAX_FINISH_MS,
  READY,
  ROWS,
  STILL_JUDGING,
  SWEEP_STAGGER_MS,
  THINKING_STEPS,
  VOTES_STEP,
  announcement,
  caption,
  finishEntry,
  firstSide,
  kindsFor,
  plan,
  popPlan,
  sceneFlags,
  type DigState,
} from "../lib/thinking";
import type { ClaimKind } from "../lib/types";

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
    expect(LABEL_STEP).toBe(1);
    expect(FIRST_POP_STEP).toBe(2);
    expect(ROWS).toBe(3);
    expect(FIRST_POP_STEP + ROWS).toBe(BEDROCK_STEP);
    expect(BEDROCK_STEP).toBeLessThan(CRUX_STEP);
    expect(CRUX_STEP).toBeLessThan(JUDGES_STEP);
    expect(JUDGES_STEP).toBeLessThan(VOTES_STEP);
    expect(VOTES_STEP).toBe(THINKING_STEPS.length - 1);
    expect(SWEEP_STAGGER_MS).toBeGreaterThan(0);
    expect(FINISH_STEPS.reduce((n, f) => n + f.ms, 0)).toBeLessThanOrEqual(MAX_FINISH_MS);
  });

  it("caption-bearing loop steps are readable (>= 1300ms)", () => {
    for (const step of [0, LABEL_STEP, BEDROCK_STEP, CRUX_STEP, JUDGES_STEP]) {
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

describe("firstSide", () => {
  it("alternates across rows within a cycle and flips per cycle", () => {
    expect([0, 1, 2].map((r) => firstSide(r, 0))).toEqual(["a", "b", "a"]);
    expect([0, 1, 2].map((r) => firstSide(r, 1))).toEqual(["b", "a", "b"]);
    for (let c = 0; c < 6; c++) {
      for (let r = 0; r < ROWS - 1; r++) expect(firstSide(r, c)).not.toBe(firstSide(r + 1, c));
      for (let r = 0; r < ROWS; r++) expect(firstSide(r, c)).not.toBe(firstSide(r, c + 1));
    }
  });

  it("over any two consecutive cycles each side goes first equally often", () => {
    for (let c = 0; c < 8; c++) {
      let a = 0;
      for (const cycle of [c, c + 1]) {
        for (let r = 0; r < ROWS; r++) if (firstSide(r, cycle) === "a") a++;
      }
      expect(a).toBe(ROWS);
    }
  });
});

describe("kindsFor", () => {
  const ALL: ClaimKind[] = ["definition", "fact", "logic", "value"];

  it("both columns carry the same multiset every cycle (B mirrors A)", () => {
    for (let c = 0; c < 8; c++) {
      const { a, b } = kindsFor(c);
      expect(a).toHaveLength(ROWS);
      expect(b).toHaveLength(ROWS);
      expect([...a].sort()).toEqual([...b].sort());
      expect(b).toEqual([...a].reverse());
    }
  });

  it("over cycles 0..3 both columns contain all four kinds", () => {
    const seenA = new Set<ClaimKind>();
    const seenB = new Set<ClaimKind>();
    for (let c = 0; c < 4; c++) {
      const { a, b } = kindsFor(c);
      a.forEach((k) => seenA.add(k));
      b.forEach((k) => seenB.add(k));
    }
    expect([...seenA].sort()).toEqual(ALL);
    expect([...seenB].sort()).toEqual(ALL);
  });
});

describe("popPlan", () => {
  const all = (s: DigState) => [0, 1, 2].map((d) => popPlan(d, s));

  it("loop: rows pop one per step from FIRST_POP_STEP", () => {
    expect(all(loop(FIRST_POP_STEP - 1))).toEqual([null, null, null]);
    expect(all(loop(FIRST_POP_STEP))).toEqual([{ delayMs: 0, fast: false }, null, null]);
    expect(all(loop(FIRST_POP_STEP + 1))).toEqual([
      { delayMs: 0, fast: false },
      { delayMs: 0, fast: false },
      null,
    ]);
    expect(all(loop(BEDROCK_STEP))).toEqual([
      { delayMs: 0, fast: false },
      { delayMs: 0, fast: false },
      { delayMs: 0, fast: false },
    ]);
  });

  it("finish from 0: settle pops nothing, sweep pops 0/250/500 fast", () => {
    expect(all(finish(0, 0))).toEqual([null, null, null]);
    expect(all(finish(1, 0))).toEqual([
      { delayMs: 0, fast: true },
      { delayMs: SWEEP_STAGGER_MS, fast: true },
      { delayMs: 2 * SWEEP_STAGGER_MS, fast: true },
    ]);
    expect(all(finish(2, 1))).toEqual(all(finish(1, 1)));
  });

  it("finish from 3: rows already popped stay, the rest sweep", () => {
    expect(all(finish(finishEntry(3), 3))).toEqual([
      { delayMs: 0, fast: false },
      { delayMs: 0, fast: false },
      { delayMs: 0, fast: true },
    ]);
  });

  it("finish from >= 4: everything already popped, unchanged", () => {
    for (const from of [4, 5, 6, 7, 8]) {
      for (let step = finishEntry(from); step < FINISH_STEPS.length; step++) {
        expect(all(finish(step, from))).toEqual([
          { delayMs: 0, fast: false },
          { delayMs: 0, fast: false },
          { delayMs: 0, fast: false },
        ]);
      }
    }
  });
});

describe("sceneFlags", () => {
  it("loop: beats switch on at their steps and stay on", () => {
    expect(sceneFlags(loop(0))).toEqual({
      tagsOn: false,
      bedrockLit: false,
      cruxLit: false,
      fastCrux: false,
      judgesIn: false,
      votesIn: false,
      fadeOut: false,
    });
    expect(sceneFlags(loop(LABEL_STEP)).tagsOn).toBe(true);
    expect(sceneFlags(loop(BEDROCK_STEP)).bedrockLit).toBe(true);
    expect(sceneFlags(loop(BEDROCK_STEP)).cruxLit).toBe(false);
    expect(sceneFlags(loop(CRUX_STEP)).cruxLit).toBe(true);
    expect(sceneFlags(loop(JUDGES_STEP)).judgesIn).toBe(true);
    expect(sceneFlags(loop(JUDGES_STEP)).votesIn).toBe(false);
    expect(sceneFlags(loop(VOTES_STEP))).toEqual({
      tagsOn: true,
      bedrockLit: true,
      cruxLit: true,
      fastCrux: false,
      judgesIn: true,
      votesIn: true,
      fadeOut: false,
    });
  });

  it("finish: judges/votes shown only if `from` had shown them", () => {
    for (const from of LOOP_STEPS) {
      for (let step = finishEntry(from); step < FINISH_STEPS.length; step++) {
        const f = sceneFlags(finish(step, from));
        expect(f.judgesIn).toBe(from >= JUDGES_STEP);
        expect(f.votesIn).toBe(from >= VOTES_STEP);
        expect(f.tagsOn).toBe(true);
      }
    }
  });

  it("finish: bedrock and crux light at the crux step", () => {
    expect(sceneFlags(finish(0, 0)).bedrockLit).toBe(false);
    expect(sceneFlags(finish(1, 0)).cruxLit).toBe(false);
    expect(sceneFlags(finish(2, 0)).bedrockLit).toBe(true);
    expect(sceneFlags(finish(2, 0)).cruxLit).toBe(true);
    expect(sceneFlags(finish(3, 0)).cruxLit).toBe(true);
  });

  it("fadeOut only at finish step 3", () => {
    for (const step of LOOP_STEPS) expect(sceneFlags(loop(step)).fadeOut).toBe(false);
    for (const from of LOOP_STEPS) {
      for (let step = finishEntry(from); step < FINISH_STEPS.length; step++) {
        expect(sceneFlags(finish(step, from)).fadeOut).toBe(step === 3);
      }
    }
  });

  it("fastCrux only when the crux animations start in finish mode", () => {
    for (const from of LOOP_STEPS) {
      for (let step = finishEntry(from); step < FINISH_STEPS.length; step++) {
        expect(sceneFlags(finish(step, from)).fastCrux).toBe(from < CRUX_STEP);
      }
    }
  });
});

describe("caption and announcement", () => {
  it("caption: loop → step caption; finish → FINISH_CAPTION unless from >= CRUX_STEP", () => {
    for (const step of LOOP_STEPS) {
      expect(caption(loop(step, 2))).toBe(THINKING_STEPS[step].caption);
    }
    for (const from of LOOP_STEPS) {
      const expected = from >= CRUX_STEP ? THINKING_STEPS[from].caption : FINISH_CAPTION;
      expect(caption(finish(finishEntry(from), from))).toBe(expected);
    }
  });

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
