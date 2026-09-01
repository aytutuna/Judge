import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/gemini", () => ({ geminiJson: vi.fn() }));

import { geminiJson } from "../lib/gemini";
import { applyCruxTrial, runCruxTrial, shouldTryCrux } from "../lib/trial";
import {
  CruxTrial,
  VerdictResult,
  type CruxTrialOutcome,
  type DisputeType,
  type FinalVerdict,
} from "../lib/types";

const mockGemini = vi.mocked(geminiJson);

function fixture(overrides: Partial<VerdictResult> = {}): VerdictResult {
  return {
    verdict: "side_a",
    dispute_type: "factual",
    confidence: 5,
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
    facts_relied_on: ["the moon is not made of cheese"],
    losing_side_best_point: "p",
    runs: ["side_a", "side_a", "side_a"],
    demo: false,
    ...overrides,
  };
}

function trial(outcome: CruxTrialOutcome, reasoning = "r"): CruxTrial {
  return { attack: "atk", outcome, reasoning };
}

beforeEach(() => {
  mockGemini.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("applyCruxTrial", () => {
  it("survived keeps confidence unchanged", () => {
    expect(applyCruxTrial(fixture({ confidence: 5 }), trial("survived")).confidence).toBe(5);
  });

  it("uncertain caps at 3", () => {
    expect(applyCruxTrial(fixture({ confidence: 5 }), trial("uncertain")).confidence).toBe(3);
    expect(applyCruxTrial(fixture({ confidence: 3 }), trial("uncertain")).confidence).toBe(3);
    expect(applyCruxTrial(fixture({ confidence: 2 }), trial("uncertain")).confidence).toBe(2);
  });

  it("overturned caps at 2", () => {
    expect(applyCruxTrial(fixture({ confidence: 5 }), trial("overturned")).confidence).toBe(2);
    expect(applyCruxTrial(fixture({ confidence: 4 }), trial("overturned")).confidence).toBe(2);
    expect(applyCruxTrial(fixture({ confidence: 1 }), trial("overturned")).confidence).toBe(1);
  });

  it("never raises confidence (1 stays 1 for every outcome)", () => {
    for (const outcome of ["survived", "uncertain", "overturned"] as const) {
      expect(applyCruxTrial(fixture({ confidence: 1 }), trial(outcome)).confidence).toBe(1);
    }
  });

  it("attaches exactly the given trial", () => {
    const t = trial("uncertain", "close call");
    expect(applyCruxTrial(fixture(), t).crux_trial).toEqual(t);
  });

  it("does not mutate the input result", () => {
    const input = fixture({ confidence: 5 });
    const snapshot = structuredClone(input);
    applyCruxTrial(input, trial("overturned"));
    expect(input).toEqual(snapshot);
  });

  it("never changes verdict or headline", () => {
    const r = applyCruxTrial(fixture(), trial("overturned"));
    expect(r.verdict).toBe("side_a");
    expect(r.headline).toBe("h");
  });

  it("is idempotent (applying the same trial twice equals once)", () => {
    const t = trial("uncertain");
    const once = applyCruxTrial(fixture({ confidence: 5 }), t);
    expect(applyCruxTrial(once, t)).toEqual(once);
  });

  it("preserves an existing lean untouched", () => {
    // Lean and trial cannot coexist in production (trials are winner-only,
    // leans non-winner-only) — cheap insurance on the spread anyway.
    const lean = { party: "b", unanimous: false, reason: "lr" } as const;
    const r = applyCruxTrial(fixture({ lean }), trial("uncertain"));
    expect(r.lean).toEqual(lean);
  });
});

describe("shouldTryCrux", () => {
  it("true for factual side_a and side_b winners with confidence >= 3", () => {
    // model_refused absent — the common aggregate output, which never sets it.
    expect(shouldTryCrux(fixture({ verdict: "side_a" }))).toBe(true);
    expect(shouldTryCrux(fixture({ verdict: "side_b" }))).toBe(true);
  });

  it("true for logical and mixed dispute types", () => {
    expect(shouldTryCrux(fixture({ dispute_type: "logical" }))).toBe(true);
    expect(shouldTryCrux(fixture({ dispute_type: "mixed" }))).toBe(true);
  });

  it("false for values and definitional disputes even with a winner", () => {
    for (const dispute_type of ["values", "definitional"] as DisputeType[]) {
      expect(shouldTryCrux(fixture({ dispute_type }))).toBe(false);
    }
  });

  it("false for non-winner verdicts", () => {
    for (const verdict of ["split", "conditional", "dissolved", "too_close"] as FinalVerdict[]) {
      expect(shouldTryCrux(fixture({ verdict }))).toBe(false);
    }
  });

  it("false when the model refused, even for side_a", () => {
    expect(shouldTryCrux(fixture({ model_refused: true }))).toBe(false);
  });

  it("false when confidence is below 3, even for a factual side_a winner", () => {
    expect(shouldTryCrux(fixture({ confidence: 2 }))).toBe(false);
    expect(shouldTryCrux(fixture({ confidence: 1 }))).toBe(false);
  });
});

describe("schema back-compat", () => {
  it("VerdictResult parses fixtures without and with crux_trial", () => {
    expect(VerdictResult.safeParse(fixture()).success).toBe(true);
    expect(
      VerdictResult.safeParse(fixture({ crux_trial: trial("overturned") })).success,
    ).toBe(true);
  });

  it("CruxTrial rejects an out-of-enum outcome", () => {
    expect(
      CruxTrial.safeParse({ attack: "a", outcome: "mistrial", reasoning: "r" }).success,
    ).toBe(false);
  });

  it("CruxTrial accepts an empty reasoning (the concession shape)", () => {
    expect(
      CruxTrial.safeParse({ attack: "a", outcome: "survived", reasoning: "" }).success,
    ).toBe(true);
  });
});

describe("runCruxTrial (mocked gemini)", () => {
  it("concession short-circuits to survived without an adjudicator call", async () => {
    mockGemini.mockResolvedValueOnce({
      ok: true,
      data: { attack: "The basis rests on settled fact; nothing sticks.", has_substantive_attack: false },
    });
    const t = await runCruxTrial("arg", fixture());
    expect(t).toEqual({
      attack: "The basis rests on settled fact; nothing sticks.",
      outcome: "survived",
      reasoning: "",
    });
    expect(mockGemini).toHaveBeenCalledTimes(1);
  });

  it("an empty attack is treated as a concession (never sent to the adjudicator)", async () => {
    mockGemini.mockResolvedValueOnce({
      ok: true,
      data: { attack: "  ", has_substantive_attack: true },
    });
    const t = await runCruxTrial("arg", fixture());
    expect(t).toEqual({ attack: "  ", outcome: "survived", reasoning: "" });
    expect(mockGemini).toHaveBeenCalledTimes(1);
  });

  it("a substantive attack goes to the adjudicator and yields its outcome", async () => {
    mockGemini
      .mockResolvedValueOnce({
        ok: true,
        data: { attack: "The inference is a false dichotomy.", has_substantive_attack: true },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { outcome: "overturned", reasoning: "The flaw defeats the basis." },
      });
    const t = await runCruxTrial("arg", fixture());
    expect(t).toEqual({
      attack: "The inference is a false dichotomy.",
      outcome: "overturned",
      reasoning: "The flaw defeats the basis.",
    });
    expect(mockGemini).toHaveBeenCalledTimes(2);
  });

  it("returns null when the attacker is safety-blocked", async () => {
    mockGemini.mockResolvedValueOnce({ ok: false, blocked: true, reason: "SAFETY" });
    expect(await runCruxTrial("arg", fixture())).toBeNull();
    expect(mockGemini).toHaveBeenCalledTimes(1);
  });

  it("returns null when the attacker call errors", async () => {
    mockGemini.mockResolvedValueOnce({ ok: false, blocked: false, error: "Gemini HTTP 429" });
    expect(await runCruxTrial("arg", fixture())).toBeNull();
    expect(mockGemini).toHaveBeenCalledTimes(1);
  });

  it("returns null when the attacker payload does not match the schema", async () => {
    mockGemini.mockResolvedValueOnce({
      ok: true,
      data: { attack: 42, has_substantive_attack: "yes" },
    });
    expect(await runCruxTrial("arg", fixture())).toBeNull();
    expect(mockGemini).toHaveBeenCalledTimes(1);
  });

  it("returns null on an out-of-enum adjudicator outcome (validation catch)", async () => {
    mockGemini
      .mockResolvedValueOnce({
        ok: true,
        data: { attack: "A real attack.", has_substantive_attack: true },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { outcome: "mistrial", reasoning: "r" },
      });
    expect(await runCruxTrial("arg", fixture())).toBeNull();
    expect(mockGemini).toHaveBeenCalledTimes(2);
  });

  it("returns null when geminiJson rejects (failure-open catch)", async () => {
    mockGemini.mockRejectedValueOnce(new Error("malformed 200 body"));
    expect(await runCruxTrial("arg", fixture())).toBeNull();
  });
});
