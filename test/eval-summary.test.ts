import { describe, expect, it } from "vitest";
import {
  formatComparison,
  formatSummary,
  summarize,
  type CaseResult,
  type EvalCase,
} from "../scripts/eval-summary";

const cases: EvalCase[] = [
  { id: "w1", lang: "en", argument: "x", expected: { dispute_type: ["factual"], verdict_one_of: ["side_b"] } },
  { id: "w2", lang: "tr", argument: "x", expected: { dispute_type: ["values"], verdict_one_of: ["side_a"] } },
  { id: "d1", argument: "x", expected: { dispute_type: ["definitional"], verdict_one_of: ["dissolved"] } },
  { id: "f1", lang: "en", argument: "x", expected: { dispute_type: ["factual"], verdict_one_of: ["side_a"] } },
  { id: "skipped", lang: "en", argument: "x", expected: { dispute_type: ["factual"], verdict_one_of: ["side_a"] } },
];

const results: CaseResult[] = [
  { id: "w1", verdict: "side_b", dispute_type: "factual", confidence: 5, runs: ["side_b", "side_b", "side_b"], downgraded: 0 },
  { id: "w2", verdict: "too_close", dispute_type: "mixed", confidence: 1, runs: ["side_a", "split", "side_b"], downgraded: 1 },
  { id: "d1", verdict: "dissolved", dispute_type: "definitional", confidence: 3, runs: ["dissolved", "dissolved", "side_a"], downgraded: 0 },
  { id: "f1", error: "Gemini HTTP 429" },
];

describe("summarize", () => {
  const s = summarize(cases, results);

  it("counts judged cases, failures and the outcome mix", () => {
    expect(s.cases).toBe(5);
    expect(s.judged).toBe(3);
    expect(s.failures).toBe(1);
    expect(s.outcomes).toMatchObject({ side_b: 1, too_close: 1, dissolved: 1, side_a: 0 });
    expect(s.clearWinner).toEqual({ hits: 1, total: 3 });
    expect(s.tooClose).toEqual({ hits: 1, total: 3 });
  });

  it("scores accuracy overall, by label kind and by language", () => {
    expect(s.accuracy).toEqual({ hits: 2, total: 3 });
    expect(s.winnerCases).toEqual({ hits: 1, total: 2 });
    expect(s.exceptionCases).toEqual({ hits: 1, total: 1 });
    expect(s.byLang).toEqual({ en: { hits: 2, total: 2 }, tr: { hits: 0, total: 1 } });
    expect(s.disputeType).toEqual({ hits: 2, total: 3 });
  });

  it("scores single runs and counts downgrades", () => {
    expect(s.runs).toEqual({ hits: 6, total: 9 });
    expect(s.downgradedRuns).toBe(1);
  });

  it("lists misses", () => {
    expect(s.misses).toEqual(["w2: got too_close (runs side_a, split, side_b), expected side_a"]);
  });
});

describe("formatting", () => {
  it("renders a summary and a before/after table", () => {
    const before = summarize(cases, results);
    const after = summarize(cases, [
      { id: "w2", verdict: "side_a", dispute_type: "values", confidence: 3, runs: ["side_a", "side_a", "split"], downgraded: 0 },
    ]);
    expect(formatSummary("x", before)).toContain("Misses:");
    const table = formatComparison(before, after);
    expect(table).toContain("| Clear winner (side_a or side_b) | 33% (1/3) | 100% (1/1) |");
    // A language present on one side only still gets a row.
    expect(table).toContain("| en cases | 100% (2/2) | n/a |");
  });
});
