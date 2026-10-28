import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/claude", () => ({ claudeJson: vi.fn() }));

import { claudeJson, type ClaudeJsonCall } from "../lib/claude";
import {
  EXTRA_RUN_TIMEOUT_MS,
  judgeExtra,
  judgeOnce,
  judgeSelfConsistent,
  PREMIUM_JUDGE_NOTE,
} from "../lib/judge";
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

beforeEach(() => {
  mockClaude.mockReset();
});

describe("judgeExtra", () => {
  it("starts every run before any finishes (parallel), alternating B-first", async () => {
    const release: Array<() => void> = [];
    mockClaude.mockImplementation(
      () =>
        new Promise((resolve) => {
          release.push(() => resolve({ ok: true, data: RUN }));
        }),
    );
    const pending = judgeExtra(4, "Party A says x; Party B says y.", "tr");
    // All four calls are in flight while none has resolved yet.
    await vi.waitFor(() => expect(mockClaude).toHaveBeenCalledTimes(4));
    release.forEach((r) => r());
    const runs = await pending;
    expect(runs).toHaveLength(4);
    expect(runs.every((r) => r.ok)).toBe(true);

    const calls = mockClaude.mock.calls.map(([call]) => call as ClaudeJsonCall);
    expect(calls.map((c) => c.system.includes(B_FIRST))).toEqual([true, false, true, false]);
    for (const c of calls) {
      expect(c.timeoutMs).toBe(EXTRA_RUN_TIMEOUT_MS);
      expect(c.system).toContain("LANGUAGE:");
    }
  });

  it("returns failed runs as results instead of throwing", async () => {
    mockClaude
      .mockResolvedValueOnce({ ok: false, blocked: false, error: "Claude HTTP 529" })
      .mockResolvedValueOnce({ ok: true, data: RUN });
    const runs = await judgeExtra(2, "text");
    expect(runs[0]).toEqual({ ok: false, blocked: false, error: "Claude HTTP 529" });
    expect(runs[1].ok).toBe(true);
  });

  it("makes no calls for n = 0", async () => {
    expect(await judgeExtra(0, "text")).toEqual([]);
    expect(mockClaude).not.toHaveBeenCalled();
  });

  it("keeps the budget inside the route's worst case", () => {
    // anonymize 60s + judges 120s + extra judges + trial 60s <= maxDuration 300s.
    expect(60_000 + 120_000 + EXTRA_RUN_TIMEOUT_MS + 60_000).toBeLessThanOrEqual(300_000);
  });
});

describe("free judge requests stay byte-identical", () => {
  // SHA-256 of the six claudeJson call objects below, taken from the code
  // before the premium options existed. A change here means the FREE judge
  // request changed: only update it for an intentional free-prompt change.
  const FREE_REQUESTS_SHA256 = "1f932e442dea1927bd255fead6b3edd8510751bb97481e7465e9fe5a83f6939a";

  it("sends exactly the pre-premium requests (no model, effort, context or note)", async () => {
    vi.stubEnv("JUDGE_RUNS", "");
    mockClaude.mockResolvedValue({ ok: false, blocked: false, error: "x" });
    await judgeSelfConsistent("Party A says x; Party B says y.", "en");
    await judgeExtra(2, "Party A says x; Party B says y.", "tr");
    await judgeOnce("text");
    const calls = mockClaude.mock.calls.map(([c]) => c as ClaudeJsonCall);
    expect(calls).toHaveLength(6);
    for (const c of calls) {
      expect(Object.keys(c)).toEqual(["system", "user", "schema", "timeoutMs"]);
      expect(c.system).not.toContain(PREMIUM_JUDGE_NOTE);
      expect(c.user).not.toContain("FACT-CHECK");
      expect(c.system).toContain(
        "VALUE FRAMEWORK: Weigh values the way broadly shared common-sense morality does: outcomes, fairness, rights, and relationships all count, none automatically dominates.",
      );
    }
    expect(createHash("sha256").update(JSON.stringify(calls)).digest("hex")).toBe(FREE_REQUESTS_SHA256);
    vi.unstubAllEnvs();
  });
});

describe("judgeOnce premium options", () => {
  it("adds model, effort, the context after the argument and the premium note", async () => {
    mockClaude.mockResolvedValue({ ok: true, data: RUN });
    const run = await judgeOnce("Party A says x.", {
      model: "claude-sonnet-5-5",
      effort: "medium",
      context: "FACT-CHECK (...):\n1. [supported] x - y (sources: a.org)",
      premium: true,
      analyzeBFirst: true,
    });
    expect(run.ok).toBe(true);
    const call = mockClaude.mock.calls[0][0] as ClaudeJsonCall;
    expect(call.model).toBe("claude-sonnet-5-5");
    expect(call.effort).toBe("medium");
    expect(call.user).toBe("THE ARGUMENT:\n\nParty A says x.\n\nFACT-CHECK (...):\n1. [supported] x - y (sources: a.org)");
    expect(call.system.endsWith(`\n\n${PREMIUM_JUDGE_NOTE}`)).toBe(true);
    expect(call.system).toContain(B_FIRST);
  });

  it("judgeExtra passes premium context and note to every extra run", async () => {
    mockClaude.mockResolvedValue({ ok: true, data: RUN });
    await judgeExtra(2, "text", "en", { context: "FACT-CHECK x", premium: true });
    for (const [c] of mockClaude.mock.calls) {
      const call = c as ClaudeJsonCall;
      expect(call.user).toBe("THE ARGUMENT:\n\ntext\n\nFACT-CHECK x");
      expect(call.system.endsWith(PREMIUM_JUDGE_NOTE)).toBe(true);
      expect(call.timeoutMs).toBe(EXTRA_RUN_TIMEOUT_MS);
      expect(call).not.toHaveProperty("model");
    }
  });
});
