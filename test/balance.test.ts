import { describe, expect, it } from "vitest";
import {
  MAX_TILT_RAD,
  sceneVerdictFrom,
  svgRotateDeg,
  tiltFromTug,
  voteOf,
} from "../lib/balance";
import type { JudgeVerdict, VerdictResult } from "../lib/types";
import { tugFinal } from "../lib/verdict-display";

function result(over: Partial<VerdictResult>): VerdictResult {
  return {
    verdict: "side_a",
    dispute_type: "factual",
    headline: "h",
    crux: "c",
    split_points: null,
    conditional: null,
    argument_map: {
      side_a: [{ claim: "a", kind: "fact" }],
      side_b: [{ claim: "b", kind: "value" }],
      bedrock_a: "ba",
      bedrock_b: "bb",
    },
    facts_relied_on: [],
    losing_side_best_point: "p",
    confidence: 4,
    runs: ["side_a", "side_a", "side_a"],
    demo: false,
    ...over,
  };
}

describe("tiltFromTug", () => {
  it("is level at 50", () => {
    expect(tiltFromTug(50)).toBe(0);
  });

  it("tips Party A down (positive) above 50 and up below", () => {
    expect(tiltFromTug(80)).toBeGreaterThan(0);
    expect(tiltFromTug(20)).toBeLessThan(0);
  });

  it("is symmetric", () => {
    for (const d of [5, 12, 30, 50]) expect(tiltFromTug(50 + d)).toBeCloseTo(-tiltFromTug(50 - d), 12);
  });

  it("matches the documented angles", () => {
    expect((tiltFromTug(80) * 180) / Math.PI).toBeCloseTo(10.31, 1);
    expect((tiltFromTug(62) * 180) / Math.PI).toBeCloseTo(4.13, 1);
  });

  it("clamps outside 0..100", () => {
    expect(tiltFromTug(100)).toBe(MAX_TILT_RAD);
    expect(tiltFromTug(140)).toBe(MAX_TILT_RAD);
    expect(tiltFromTug(0)).toBe(-MAX_TILT_RAD);
    expect(tiltFromTug(-30)).toBe(-MAX_TILT_RAD);
  });
});

describe("svgRotateDeg", () => {
  it("has the opposite sign of the three.js tilt (SVG is clockwise-positive)", () => {
    expect(svgRotateDeg(80)).toBeLessThan(0);
    expect(svgRotateDeg(20)).toBeGreaterThan(0);
    expect(svgRotateDeg(80)).toBeCloseTo((-tiltFromTug(80) * 180) / Math.PI, 12);
  });

  it("is exactly 0 (not -0) when level", () => {
    expect(Object.is(svgRotateDeg(50), 0)).toBe(true);
  });
});

describe("voteOf", () => {
  it("covers every JudgeVerdict", () => {
    const cases: Record<JudgeVerdict, string> = {
      side_a: "a",
      side_b: "b",
      split: "other",
      conditional: "other",
      dissolved: "other",
    };
    for (const [run, vote] of Object.entries(cases)) expect(voteOf(run as JudgeVerdict)).toBe(vote);
  });
});

describe("sceneVerdictFrom", () => {
  it("side_a: 80, three votes for A", () => {
    expect(sceneVerdictFrom(result({}))).toEqual({ tugA: 80, votes: ["a", "a", "a"] });
  });

  it("side_b: 20, mixed runs keep their own colour", () => {
    const r = result({ verdict: "side_b", runs: ["side_b", "side_b", "split"] });
    expect(sceneVerdictFrom(r)).toEqual({ tugA: 20, votes: ["b", "b", "other"] });
  });

  it("lean a / lean b: 62 / 38", () => {
    const leanA = result({
      verdict: "too_close",
      runs: ["side_a", "side_b", "split"],
      lean: { party: "a", unanimous: false, reason: "r" },
    });
    const leanB = result({
      verdict: "split",
      runs: ["split", "split", "split"],
      lean: { party: "b", unanimous: true, reason: "r" },
    });
    expect(sceneVerdictFrom(leanA)).toEqual({ tugA: 62, votes: ["a", "b", "other"] });
    expect(sceneVerdictFrom(leanB)).toEqual({ tugA: 38, votes: ["other", "other", "other"] });
  });

  it("a lean tie (lean: null) and too_close without a lean are level", () => {
    expect(sceneVerdictFrom(result({ verdict: "dissolved", runs: ["dissolved"], lean: null })).tugA).toBe(50);
    expect(sceneVerdictFrom(result({ verdict: "too_close", runs: ["side_a", "side_b"] })).tugA).toBe(50);
  });

  it("a refusal is level with no votes", () => {
    expect(sceneVerdictFrom(result({ model_refused: true, runs: ["side_a"] }))).toEqual({ tugA: 50, votes: [] });
  });

  it("an escalated 5-run verdict gets five orbs", () => {
    const r = result({
      verdict: "side_b",
      escalated: true,
      runs: ["side_b", "side_a", "side_b", "side_b", "conditional"],
    });
    expect(sceneVerdictFrom(r)).toEqual({ tugA: 20, votes: ["b", "a", "b", "b", "other"] });
  });

  it("always agrees with the tug bar", () => {
    for (const verdict of ["side_a", "side_b", "split", "too_close"] as const) {
      const r = result({ verdict, lean: verdict === "split" ? { party: "a", unanimous: true, reason: "" } : undefined });
      expect(sceneVerdictFrom(r).tugA).toBe(tugFinal(r));
    }
  });
});
