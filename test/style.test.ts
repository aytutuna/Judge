import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/claude", () => ({ claudeJson: vi.fn() }));

import { claudeJson, type ClaudeJsonCall } from "../lib/claude";
import { judgeOnce } from "../lib/judge";
import { HUMAN_STYLE_EN, HUMAN_STYLE_TR, humanStyle } from "../lib/style";
import { runCruxTrial } from "../lib/trial";
import type { VerdictResult } from "../lib/types";

const mockClaude = vi.mocked(claudeJson);

function systems(): string[] {
  return mockClaude.mock.calls.map(([call]) => (call as ClaudeJsonCall).system);
}

const RESULT: VerdictResult = {
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
  facts_relied_on: ["f"],
  losing_side_best_point: "p",
  runs: ["side_a", "side_a", "side_a"],
  demo: false,
};

beforeEach(() => {
  mockClaude.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("humanStyle", () => {
  it("picks the block for the language", () => {
    expect(humanStyle("en")).toBe(HUMAN_STYLE_EN);
    expect(humanStyle("tr")).toBe(HUMAN_STYLE_TR);
  });

  it("blocks carry no surrounding blank lines (callers add separators)", () => {
    for (const s of [HUMAN_STYLE_EN, HUMAN_STYLE_TR]) expect(s).toBe(s.trim());
  });

  it("keeps the Turkish register and party labels", () => {
    expect(HUMAN_STYLE_TR).toContain('"sen", never "siz"');
    expect(HUMAN_STYLE_TR).toContain('"Taraf A" and "Taraf B"');
  });
});

describe("judge prompt voice", () => {
  beforeEach(() => {
    mockClaude.mockResolvedValue({ ok: false, blocked: false, error: "x" });
  });

  it("English prompt ends with the English voice and has no Turkish block", async () => {
    await judgeOnce("arg", { preset: "balanced" }, { lang: "en" });
    const [system] = systems();
    expect(system.endsWith(HUMAN_STYLE_EN)).toBe(true);
    expect(system).not.toContain("LANGUAGE:");
    expect(system).not.toContain(HUMAN_STYLE_TR);
  });

  it("Turkish prompt keeps the load-bearing LANGUAGE rules ahead of the Turkish voice", async () => {
    await judgeOnce("arg", { preset: "balanced" }, { lang: "tr" });
    const [system] = systems();
    const language = system.indexOf("LANGUAGE:");
    expect(language).toBeGreaterThan(-1);
    expect(system.indexOf(HUMAN_STYLE_TR)).toBeGreaterThan(language);
    expect(system.endsWith(HUMAN_STYLE_TR)).toBe(true);
    const block = system.slice(language, system.indexOf(HUMAN_STYLE_TR));
    expect(block).toContain('informal "sen", never "siz"');
    expect(block).toContain("-sa/-se");
    expect(block).toContain("headline stays at most 10 words");
    expect(system).not.toContain(HUMAN_STYLE_EN);
  });
});

describe("trial prompt voice", () => {
  function attackThenRefereeCalls() {
    mockClaude
      .mockResolvedValueOnce({
        ok: true,
        data: { attack: "A hidden premise does the work.", has_substantive_attack: true },
      })
      .mockResolvedValueOnce({ ok: true, data: { outcome: "uncertain", reasoning: "r" } });
  }

  it("both English calls get the English voice", async () => {
    attackThenRefereeCalls();
    await runCruxTrial("arg", RESULT, "en");
    const calls = systems();
    expect(calls).toHaveLength(2);
    for (const s of calls) {
      expect(s.endsWith(HUMAN_STYLE_EN)).toBe(true);
      expect(s).not.toContain("LANGUAGE:");
    }
  });

  it("both Turkish calls get the LANGUAGE block, then the Turkish voice", async () => {
    attackThenRefereeCalls();
    await runCruxTrial("arg", RESULT, "tr");
    const calls = systems();
    expect(calls).toHaveLength(2);
    for (const s of calls) {
      expect(s.endsWith(HUMAN_STYLE_TR)).toBe(true);
      expect(s.indexOf("LANGUAGE:")).toBeGreaterThan(-1);
      expect(s.indexOf("LANGUAGE:")).toBeLessThan(s.indexOf(HUMAN_STYLE_TR));
    }
  });
});
