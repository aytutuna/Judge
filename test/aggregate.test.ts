import { describe, expect, it } from "vitest";
import { aggregate } from "../lib/aggregate";
import type { JudgeOutput, JudgeVerdict } from "../lib/types";

function run(verdict: JudgeVerdict, dispute_type: JudgeOutput["dispute_type"] = "factual"): JudgeOutput {
  return {
    verdict,
    dispute_type,
    headline: "h",
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
  };
}

describe("aggregate", () => {
  it("unanimous 3/3 with same dispute type -> confidence 5", () => {
    const r = aggregate([run("side_a"), run("side_a"), run("side_a")]);
    expect(r.verdict).toBe("side_a");
    expect(r.confidence).toBe(5);
    expect(r.runs).toEqual(["side_a", "side_a", "side_a"]);
  });

  it("unanimous verdict but mixed dispute types -> confidence 4", () => {
    const r = aggregate([run("side_a", "factual"), run("side_a", "mixed"), run("side_a", "factual")]);
    expect(r.confidence).toBe(4);
  });

  it("2/3 majority with adjacent dissenter -> confidence 3", () => {
    const r = aggregate([run("side_a"), run("side_a"), run("split")]);
    expect(r.verdict).toBe("side_a");
    expect(r.confidence).toBe(3);
  });

  it("2/3 majority with opposite-side dissenter -> confidence 2", () => {
    const r = aggregate([run("side_a"), run("side_a"), run("side_b")]);
    expect(r.verdict).toBe("side_a");
    expect(r.confidence).toBe(2);
  });

  it("three-way disagreement -> too_close, confidence 1", () => {
    const r = aggregate([run("side_a"), run("side_b"), run("dissolved")]);
    expect(r.verdict).toBe("too_close");
    expect(r.confidence).toBe(1);
    expect(r.headline).toBe("Too close to call");
  });

  it("only 2 surviving runs caps confidence at 4", () => {
    const r = aggregate([run("side_a"), run("side_a")]);
    expect(r.confidence).toBe(4);
  });

  it("single surviving run caps confidence at 2", () => {
    const r = aggregate([run("conditional", "values")]);
    expect(r.verdict).toBe("conditional");
    expect(r.confidence).toBe(2);
  });

  it("throws on zero runs", () => {
    expect(() => aggregate([])).toThrow();
  });
});
