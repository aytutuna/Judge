import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/claude", () => ({ claudeJson: vi.fn() }));

import { claudeJson, type ClaudeJsonCall } from "../lib/claude";
import { EXTRA_RUN_TIMEOUT_MS, judgeExtra } from "../lib/judge";
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
    const pending = judgeExtra(4, "Party A says x; Party B says y.", { preset: "balanced" }, "tr");
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
    const runs = await judgeExtra(2, "text", { preset: "balanced" });
    expect(runs[0]).toEqual({ ok: false, blocked: false, error: "Claude HTTP 529" });
    expect(runs[1].ok).toBe(true);
  });

  it("makes no calls for n = 0", async () => {
    expect(await judgeExtra(0, "text", { preset: "balanced" })).toEqual([]);
    expect(mockClaude).not.toHaveBeenCalled();
  });

  it("keeps the budget inside the route's worst case", () => {
    // anonymize 60s + judges 120s + extra judges + trial 60s <= maxDuration 300s.
    expect(60_000 + 120_000 + EXTRA_RUN_TIMEOUT_MS + 60_000).toBeLessThanOrEqual(300_000);
  });
});
