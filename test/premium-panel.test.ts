import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/claude", () => ({
  claudeJson: vi.fn(),
  defaultJudgeEffort: () => {
    const e = process.env.JUDGE_EFFORT;
    return e === "low" || e === "medium" || e === "high" ? e : "medium";
  },
}));

import { claudeJson, type ClaudeJsonCall } from "../lib/claude";
import { PREMIUM_JUDGE_NOTE } from "../lib/judge";
import { judgePremiumPanel, premiumPanel, SEAT_RETRY_TIMEOUT_MS } from "../lib/premium/panel";
import type { JudgeRunOutput } from "../lib/types";

const mockClaude = vi.mocked(claudeJson);

const RUN: JudgeRunOutput = {
  verdict: "side_a",
  dispute_type: "factual",
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
  leaning: "side_a",
  leaning_reason: "lr",
};

const B_FIRST = "analyze Party B's case fully before Party A's";
const CONTEXT = "FACT-CHECK (web search run before judging; evidence, not a ruling):\n1. [refuted] x - y (sources: a.org)";

beforeEach(() => {
  mockClaude.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("premiumPanel", () => {
  it("defaults to two Sonnet seats and one Haiku seat, odd seats B-first", () => {
    expect(premiumPanel({})).toEqual([
      { model: "claude-sonnet-5-5", analyzeBFirst: false, effort: "medium" },
      { model: "claude-sonnet-5-5", analyzeBFirst: true, effort: "medium" },
      { model: "claude-haiku-5-5", analyzeBFirst: false, effort: "medium" },
    ]);
  });

  it("reads PREMIUM_JUDGE_MODELS (1 to 5 seats) and PREMIUM_SONNET_EFFORT; Haiku keeps JUDGE_EFFORT", () => {
    vi.stubEnv("JUDGE_EFFORT", "low");
    const seats = premiumPanel({
      PREMIUM_JUDGE_MODELS: " claude-haiku-5-5 , claude-sonnet-5-5,claude-opus-5-5,claude-haiku-5-5,claude-sonnet-5-5,claude-sonnet-5-5",
      PREMIUM_SONNET_EFFORT: "high",
    });
    expect(seats).toHaveLength(5);
    expect(seats.map((s) => s.model)).toEqual([
      "claude-haiku-5-5",
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "claude-haiku-5-5",
      "claude-sonnet-5-5",
    ]);
    expect(seats.map((s) => s.effort)).toEqual(["low", "high", "high", "low", "high"]);
    expect(seats.map((s) => s.analyzeBFirst)).toEqual([false, true, false, true, false]);
  });

  it("falls back to the default panel when nothing valid is listed, and to medium for a bad effort", () => {
    const seats = premiumPanel({ PREMIUM_JUDGE_MODELS: " , gpt-x, ", PREMIUM_SONNET_EFFORT: "max" });
    expect(seats.map((s) => s.model)).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(seats[0].effort).toBe("medium");
  });
});

describe("judgePremiumPanel", () => {
  it("runs every seat in parallel with its model, effort, the premium note and the context", async () => {
    const release: Array<() => void> = [];
    mockClaude.mockImplementation(
      () => new Promise((resolve) => release.push(() => resolve({ ok: true, data: RUN }))),
    );
    const pending = judgePremiumPanel("Party A says x.", { preset: "balanced" }, "tr", CONTEXT, premiumPanel({}));
    await vi.waitFor(() => expect(mockClaude).toHaveBeenCalledTimes(3));
    release.forEach((r) => r());
    const { runs, models } = await pending;
    expect(runs.every((r) => r.ok)).toBe(true);
    expect(models).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);

    const calls = mockClaude.mock.calls.map(([c]) => c as ClaudeJsonCall);
    expect(calls.map((c) => c.model)).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(calls.map((c) => c.effort)).toEqual(["medium", "medium", "medium"]);
    expect(calls.map((c) => c.system.includes(B_FIRST))).toEqual([false, true, false]);
    for (const c of calls) {
      expect(c.system.endsWith(`\n\n${PREMIUM_JUDGE_NOTE}`)).toBe(true);
      expect(c.system).toContain("LANGUAGE:");
      expect(c.user).toBe(`THE ARGUMENT:\n\nParty A says x.\n\n${CONTEXT}`);
      expect(c).not.toHaveProperty("temperature");
    }
  });

  it("sends no context when there is none", async () => {
    mockClaude.mockResolvedValue({ ok: true, data: RUN });
    await judgePremiumPanel("text", { preset: "balanced" }, "en", null, premiumPanel({}));
    for (const [c] of mockClaude.mock.calls) expect((c as ClaudeJsonCall).user).toBe("THE ARGUMENT:\n\ntext");
  });

  it("reruns a refused Sonnet seat once on Haiku and records the model that served", async () => {
    mockClaude.mockImplementation(async (call) =>
      call.model === "claude-sonnet-5-5" && !call.system.includes(B_FIRST)
        ? { ok: false, blocked: true, reason: "general_harms" }
        : { ok: true, data: RUN },
    );
    const { runs, models } = await judgePremiumPanel("text", { preset: "balanced" }, "en", null, premiumPanel({}));
    expect(runs).toHaveLength(3);
    expect(runs.every((r) => r.ok)).toBe(true);
    expect(models).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    const retry = mockClaude.mock.calls.map(([c]) => c as ClaudeJsonCall).find((c) => c.timeoutMs === SEAT_RETRY_TIMEOUT_MS);
    expect(retry?.model).toBe("claude-haiku-5-5");
    expect(retry?.system.endsWith(PREMIUM_JUDGE_NOTE)).toBe(true);
    expect(mockClaude).toHaveBeenCalledTimes(4);
  });

  it("does not rerun Haiku refusals or plain failures; models lists only successful runs", async () => {
    mockClaude.mockImplementation(async (call) => {
      if (call.model === "claude-haiku-5-5") return { ok: false, blocked: true, reason: "general_harms" };
      if (call.system.includes(B_FIRST)) return { ok: false, blocked: false, error: "Claude HTTP 529" };
      return { ok: true, data: RUN };
    });
    const { runs, models } = await judgePremiumPanel("text", { preset: "balanced" }, "en", null, premiumPanel({}));
    expect(mockClaude).toHaveBeenCalledTimes(3);
    expect(runs.map((r) => r.ok)).toEqual([true, false, false]);
    expect(models).toEqual(["claude-sonnet-5-5"]);
  });

  it("never throws when a seat rejects", async () => {
    mockClaude.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ ok: true, data: RUN });
    const { runs, models } = await judgePremiumPanel("text", { preset: "balanced" }, "en", null, premiumPanel({}));
    expect(runs[0]).toMatchObject({ ok: false, blocked: false });
    expect(models).toHaveLength(2);
  });
});
