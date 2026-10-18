import { describe, expect, it } from "vitest";
import { enforceCriteria, meetsExceptionCriteria } from "../lib/criteria";
import type { JudgeRunOutput } from "../lib/types";

function run(overrides: Partial<JudgeRunOutput>): JudgeRunOutput {
  return {
    verdict: "side_a",
    exception_basis: null,
    dispute_type: "mixed",
    headline: "model headline",
    crux: "c",
    split_points: null,
    conditional: null,
    argument_map: {
      side_a: [{ claim: "a", kind: "fact" }],
      side_b: [{ claim: "b", kind: "fact" }],
      bedrock_a: "ba",
      bedrock_b: "bb",
    },
    facts_relied_on: [],
    losing_side_best_point: "p",
    leaning: "side_a",
    leaning_reason: "B is more right under ordinary usage.",
    ...overrides,
  };
}

const bothPoints = [
  { party: "a" as const, point: "right about cost" },
  { party: "b" as const, point: "right about timing" },
];
const twoBranches = [
  { if_value: "if safety first", then: "A" },
  { if_value: "if freedom first", then: "B" },
];

describe("meetsExceptionCriteria", () => {
  it("winner verdicts always pass", () => {
    expect(meetsExceptionCriteria(run({ verdict: "side_b", leaning: "side_b" }))).toBe(true);
  });

  it("split needs a basis and a point for each party", () => {
    expect(meetsExceptionCriteria(run({ verdict: "split", exception_basis: "x", split_points: bothPoints }))).toBe(true);
    expect(
      meetsExceptionCriteria(run({ verdict: "split", exception_basis: "x", split_points: [bothPoints[0], bothPoints[0]] })),
    ).toBe(false);
    expect(meetsExceptionCriteria(run({ verdict: "split", exception_basis: "x", split_points: null }))).toBe(false);
    expect(meetsExceptionCriteria(run({ verdict: "split", exception_basis: null, split_points: bothPoints }))).toBe(false);
  });

  it("conditional needs a basis and at least two branches", () => {
    expect(meetsExceptionCriteria(run({ verdict: "conditional", exception_basis: "x", conditional: twoBranches }))).toBe(true);
    expect(
      meetsExceptionCriteria(run({ verdict: "conditional", exception_basis: "x", conditional: [twoBranches[0]] })),
    ).toBe(false);
    expect(meetsExceptionCriteria(run({ verdict: "conditional", exception_basis: "  ", conditional: twoBranches }))).toBe(false);
  });

  it("dissolved needs a non-blank basis", () => {
    expect(meetsExceptionCriteria(run({ verdict: "dissolved", exception_basis: "'tea' means two things" }))).toBe(true);
    expect(meetsExceptionCriteria(run({ verdict: "dissolved", exception_basis: "" }))).toBe(false);
    expect(meetsExceptionCriteria(run({ verdict: "dissolved", exception_basis: null }))).toBe(false);
  });
});

describe("enforceCriteria", () => {
  it("a qualifying exception passes through with a trimmed basis", () => {
    const input = run({ verdict: "split", exception_basis: "  two sub-questions  ", split_points: bothPoints });
    const { run: out, downgraded } = enforceCriteria(input);
    expect(downgraded).toBe(false);
    expect(out.verdict).toBe("split");
    expect(out.exception_basis).toBe("two sub-questions");
    expect(out.split_points).toEqual(bothPoints);
  });

  it("a failing exception becomes the run's forced ruling", () => {
    const input = run({
      verdict: "split",
      exception_basis: null,
      split_points: [bothPoints[1]],
      leaning: "side_b",
    });
    const { run: out, downgraded } = enforceCriteria(input);
    expect(downgraded).toBe(true);
    expect(out.verdict).toBe("side_b");
    expect(out.headline).toBe(input.leaning_reason);
    expect(out.split_points).toBeNull();
    expect(out.conditional).toBeNull();
    expect(out.exception_basis).toBeNull();
    // Analysis fields survive.
    expect(out.crux).toBe(input.crux);
    expect(out.argument_map).toEqual(input.argument_map);
  });

  it("winner runs get their leaning aligned with the verdict and no basis", () => {
    const { run: out, downgraded } = enforceCriteria(
      run({ verdict: "side_b", leaning: "side_a", exception_basis: "stray" }),
    );
    expect(downgraded).toBe(false);
    expect(out.leaning).toBe("side_b");
    expect(out.exception_basis).toBeNull();
  });

  it("never mutates its input", () => {
    const input = run({ verdict: "dissolved", exception_basis: null, leaning: "side_b" });
    const snapshot = structuredClone(input);
    enforceCriteria(input);
    expect(input).toEqual(snapshot);
  });
});
