import { describe, expect, it } from "vitest";
import { aggregate } from "../lib/aggregate";
import {
  VerdictResult,
  type JudgeRunOutput,
  type JudgeVerdict,
  type JudgeVerdictSide,
} from "../lib/types";

function run(
  verdict: JudgeVerdict,
  dispute_type: JudgeRunOutput["dispute_type"] = "factual",
  leaning: JudgeVerdictSide = "side_a",
  leaning_reason = "lr",
): JudgeRunOutput {
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
    leaning,
    leaning_reason,
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
    const r = aggregate([run("side_a"), run("side_b", "factual", "side_b"), run("dissolved")]);
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

describe("forced-ruling lean", () => {
  it("3/3 same leaning on a dissolved verdict -> unanimous lean", () => {
    const r = aggregate([
      run("dissolved", "definitional", "side_b", "first"),
      run("dissolved", "definitional", "side_b", "second"),
      run("dissolved", "definitional", "side_b", "third"),
    ]);
    expect(r.verdict).toBe("dissolved");
    expect(r.lean).toEqual({ party: "b", unanimous: true, reason: "first" });
  });

  it("2/1 leaning -> not unanimous, reason from a majority-side run", () => {
    const r = aggregate([
      run("split", "mixed", "side_a", "dissenter"),
      run("split", "mixed", "side_b", "maj-1"),
      run("split", "mixed", "side_b", "maj-2"),
    ]);
    expect(r.verdict).toBe("split");
    expect(r.lean).toEqual({ party: "b", unanimous: false, reason: "maj-1" });
  });

  it("two-run 1-1 leaning tie on a non-winner verdict -> lean is null", () => {
    const r = aggregate([
      run("conditional", "values", "side_a"),
      run("conditional", "values", "side_b"),
    ]);
    expect(r.verdict).toBe("conditional");
    expect(r.lean).toBeNull();
  });

  it("two-run same leaning on a non-winner verdict -> unanimous lean", () => {
    // The n=2 path is live in production: a 429-killed third run is the
    // free-tier expected case.
    const r = aggregate([
      run("conditional", "values", "side_a", "why"),
      run("conditional", "values", "side_a", "why too"),
    ]);
    expect(r.lean).toEqual({ party: "a", unanimous: true, reason: "why" });
  });

  it("single-run non-winner verdict -> lean present, vacuously unanimous", () => {
    // Vacuous at the data level; the UI suppresses the agreement note for
    // runs.length < 2 (that guard lives in VerdictReveal).
    const r = aggregate([run("dissolved", "definitional", "side_b", "solo")]);
    expect(r.lean).toEqual({ party: "b", unanimous: true, reason: "solo" });
  });

  it("winner verdicts carry no lean at all (absent, not null)", () => {
    const r = aggregate([
      run("side_a", "factual", "side_a"),
      run("side_a", "factual", "side_a"),
      run("side_a", "factual", "side_b"),
    ]);
    expect(r.verdict).toBe("side_a");
    expect("lean" in r).toBe(false);
    expect(r.lean).toBeUndefined();
  });

  it("too_close (3-way verdict split) still computes the lean", () => {
    const r = aggregate([
      run("side_a", "factual", "side_a", "one"),
      run("side_b", "factual", "side_a", "two"),
      run("dissolved", "factual", "side_b", "three"),
    ]);
    expect(r.verdict).toBe("too_close");
    expect(r.lean).toEqual({ party: "a", unanimous: false, reason: "one" });
  });

  it("spread hygiene: run-level leaning fields never leak into the result", () => {
    const nonWinner = aggregate([run("split", "mixed"), run("split", "mixed")]);
    const winner = aggregate([run("side_a"), run("side_a")]);
    const tooClose = aggregate([run("side_a"), run("side_b"), run("dissolved")]);
    for (const r of [nonWinner, winner, tooClose]) {
      expect(r).not.toHaveProperty("leaning");
      expect(r).not.toHaveProperty("leaning_reason");
    }
  });
});

describe("no-majority rescue", () => {
  it("unanimous lean with a winner run among split/conditional -> that side at confidence 2", () => {
    const winner = { ...run("side_a", "factual", "side_a"), headline: "winner-h", crux: "winner-c" };
    const r = aggregate([
      run("split", "mixed", "side_a"),
      winner,
      run("conditional", "values", "side_a"),
    ]);
    expect(r.verdict).toBe("side_a");
    expect(r.confidence).toBe(2);
    expect(r.lean).toBeUndefined();
    expect(r.runs).toEqual(["split", "side_a", "conditional"]);
    expect(r.headline).toBe("winner-h");
    expect(r.crux).toBe("winner-c");
    expect(r).not.toHaveProperty("leaning");
    expect(r).not.toHaveProperty("leaning_reason");
  });

  it("unanimous lean but no run ruled for that side -> too_close with lean", () => {
    const r = aggregate([
      run("split", "mixed", "side_a", "one"),
      run("conditional", "values", "side_a"),
      run("dissolved", "definitional", "side_a"),
    ]);
    expect(r.verdict).toBe("too_close");
    expect(r.lean).toEqual({ party: "a", unanimous: true, reason: "one" });
  });

  it("non-unanimous lean -> too_close", () => {
    const r = aggregate([
      run("side_a", "factual", "side_a"),
      run("side_b", "factual", "side_b"),
      run("split", "mixed", "side_a"),
    ]);
    expect(r.verdict).toBe("too_close");
    expect(r.confidence).toBe(1);
    expect(r.lean?.unanimous).toBe(false);
  });

  it("two runs, side_b + split both leaning side_b -> side_b at confidence 2", () => {
    const r = aggregate([
      run("side_b", "factual", "side_b"),
      run("split", "mixed", "side_b"),
    ]);
    expect(r.verdict).toBe("side_b");
    expect(r.confidence).toBe(2);
    expect(r.lean).toBeUndefined();
  });
});

describe("VerdictResult back-compat", () => {
  function stored(lean?: VerdictResult["lean"]): unknown {
    const base: Record<string, unknown> = {
      verdict: "split",
      dispute_type: "mixed",
      confidence: 3,
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
      runs: ["split", "split", "side_a"],
      demo: false,
    };
    if (lean !== undefined) base.lean = lean;
    return base;
  }

  it("parses old rows without lean", () => {
    expect(VerdictResult.safeParse(stored()).success).toBe(true);
  });

  it("parses a stored lean tie (null)", () => {
    expect(VerdictResult.safeParse(stored(null)).success).toBe(true);
  });

  it("parses a full lean object", () => {
    const parsed = VerdictResult.safeParse(
      stored({ party: "a", unanimous: false, reason: "r" }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.lean).toEqual({ party: "a", unanimous: false, reason: "r" });
    }
  });

  it("aggregate output for a non-winner verdict round-trips through VerdictResult", () => {
    const r = aggregate([run("dissolved", "definitional", "side_a")]);
    expect(VerdictResult.safeParse(r).success).toBe(true);
  });
});
