import { describe, expect, it } from "vitest";
import {
  CHECKLIST_KEYS,
  PREMIUM_CHECKLIST_KEYS,
  REVEAL_HOLD_MS,
  STEP_TO_ROW,
  checklistRowKey,
  checklistState,
  judgeDots,
  judgingBeatFor,
  progressAt,
} from "../lib/judging-ui";
import { STRINGS } from "../lib/i18n";
import { FINISH_STEPS, MAX_FINISH_MS, THINKING_STEPS, type DigState } from "../lib/thinking";
import type { VerdictResult } from "../lib/types";

const loop = (step: number, cycle = 0): DigState => ({ mode: "loop", step, cycle });

describe("judgingBeatFor", () => {
  it("maps every cycle-0 step to the plan's beat", () => {
    const expected = ["lift", "sort", "dig", "dig", "dig", "dig", "crux", "orbs", "orbs"];
    expect(THINKING_STEPS.length).toBe(expected.length);
    THINKING_STEPS.forEach((_, step) => expect(judgingBeatFor(loop(step)), `step ${step}`).toBe(expected[step]));
  });

  it("deliberates on every later cycle, whatever the step", () => {
    for (const cycle of [1, 2, 7]) {
      THINKING_STEPS.forEach((_, step) => expect(judgingBeatFor(loop(step, cycle))).toBe("deliberate"));
    }
  });

  it("holds the orbs during the finish sequence", () => {
    expect(judgingBeatFor({ mode: "finish", step: 1, from: 3, cycle: 0 })).toBe("orbs");
  });
});

describe("checklistState", () => {
  it("walks the rows on cycle 0", () => {
    expect(STEP_TO_ROW).toEqual([0, 1, 2, 2, 2, 2, 3, 4, 5]);
    expect(checklistState(loop(0), false).rows).toEqual(["active", "pending", "pending", "pending", "pending", "pending"]);
    expect(checklistState(loop(4), false).rows).toEqual(["done", "done", "active", "pending", "pending", "pending"]);
    expect(checklistState(loop(8), false).rows).toEqual(["done", "done", "done", "done", "done", "active"]);
    expect(checklistState(loop(8), false)).toMatchObject({ stillJudging: false, ready: false });
  });

  it("parks on the judges row on later cycles", () => {
    const s = checklistState(loop(2, 1), false);
    expect(s.rows).toEqual(["done", "done", "done", "done", "active", "pending"]);
    expect(s.stillJudging).toBe(true);
    expect(s.ready).toBe(false);
  });

  it("puts the premium fact-check before the judges and leaves the free list alone", () => {
    expect(CHECKLIST_KEYS).toHaveLength(6);
    const k = PREMIUM_CHECKLIST_KEYS as readonly string[];
    expect(k.indexOf("thinking.label")).toBeLessThan(k.indexOf("thinking.factcheck"));
    expect(k.indexOf("thinking.factcheck")).toBeLessThan(k.indexOf("thinking.judges"));
    expect(checklistState(loop(2), false, true).rows[2]).toBe("active");
    expect(checklistState(loop(2), false, true).rows[0]).toBe("done");
    expect(checklistState(loop(2, 1), false, true).rows.slice(0, 7)).toEqual([
      "done", "done", "done", "done", "done", "active", "pending",
    ]);
    expect(checklistState(loop(8), false, true).rows[6]).toBe("active");
  });

  it("completes when done or finishing", () => {
    for (const s of [checklistState(loop(1), true), checklistState({ mode: "finish", step: 0, from: 1, cycle: 0 }, false)]) {
      expect(s.rows.every((r) => r === "done")).toBe(true);
      expect(s.ready).toBe(true);
    }
  });

  it("uses real dictionary keys", () => {
    for (const k of [...CHECKLIST_KEYS, "thinking.stillJudging", "thinking.ready"] as const) {
      expect(STRINGS.en[k]).toBeTruthy();
      expect(STRINGS.tr[k]).toBeTruthy();
    }
  });
});

describe("progressAt", () => {
  it("is monotonic and stays below .92 until done", () => {
    let prev = -1;
    for (let ms = 0; ms <= 300_000; ms += 500) {
      const p = progressAt(ms, false);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeLessThan(0.92);
      prev = p;
    }
  });

  it("matches the documented checkpoints", () => {
    expect(progressAt(10_000, false)).toBeCloseTo(0.62, 2);
    expect(progressAt(20_000, false)).toBeCloseTo(0.82, 2);
    expect(progressAt(30_000, false)).toBeCloseTo(0.89, 2);
  });

  it("is 1 once done", () => {
    expect(progressAt(0, true)).toBe(1);
    expect(progressAt(12_345, true)).toBe(1);
  });
});

describe("REVEAL_HOLD_MS", () => {
  it("fits the worst finish sequence inside the page's safety net", () => {
    const worst = FINISH_STEPS.reduce((s, f) => s + f.ms, 0);
    expect(worst + REVEAL_HOLD_MS).toBeLessThan(MAX_FINISH_MS + 2000);
  });
});

describe("judgeDots", () => {
  const base = { runs: ["side_a", "side_b", "split"], model_refused: false } as unknown as VerdictResult;

  it("shows three neutral dots until done", () => {
    expect(judgeDots(null, false)).toEqual(["pending", "pending", "pending"]);
    expect(judgeDots(base, false)).toEqual(["pending", "pending", "pending"]);
    expect(judgeDots(null, true)).toEqual(["pending", "pending", "pending"]);
  });

  it("colours each run once done, more dots after an escalation", () => {
    expect(judgeDots(base, true)).toEqual(["a", "b", "other"]);
    const escalated = { ...base, runs: ["side_b", "side_b", "side_a", "side_b", "dissolved"] } as VerdictResult;
    expect(judgeDots(escalated, true)).toEqual(["b", "b", "a", "b", "other"]);
  });

  it("keeps neutral dots on a refusal", () => {
    expect(judgeDots({ ...base, model_refused: true } as VerdictResult, true)).toEqual(["pending", "pending", "pending"]);
  });
});

describe("checklistRowKey", () => {
  it("says the web check finished only once the verdict is in", () => {
    // The timed story ticks the row over long before the real check ends.
    const early = checklistState(loop(4), false, true);
    expect(early.rows[2]).toBe("done");
    expect(checklistRowKey("thinking.factcheck", early.rows[2], early.stillJudging, false)).toBe("thinking.factcheck");
    const later = checklistState(loop(2, 1), false, true);
    expect(checklistRowKey("thinking.factcheck", later.rows[2], later.stillJudging, false)).toBe("thinking.factcheck");
    const done = checklistState(loop(4), true, true);
    expect(checklistRowKey("thinking.factcheck", done.rows[2], done.stillJudging, true)).toBe("thinking.factcheckDone");
  });

  it("keeps the still-judging caption on the active row and other rows as they are", () => {
    expect(checklistRowKey("thinking.judges", "active", true, false)).toBe("thinking.stillJudging");
    expect(checklistRowKey("thinking.read", "done", false, false)).toBe("thinking.read");
    expect(checklistRowKey("thinking.read", "done", false, true)).toBe("thinking.read");
  });
});
