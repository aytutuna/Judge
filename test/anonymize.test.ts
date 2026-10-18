import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const claudeJson = vi.hoisted(() => vi.fn());

vi.mock("../lib/claude", () => ({
  claudeJson,
  hasApiKey: () => Boolean(process.env.ANTHROPIC_API_KEY),
  LITE_MODEL: "test-model",
}));

import { anonymize, AnonymizeError } from "../lib/anonymize";

const RAW = "Mark thinks pineapple belongs on pizza and Ana disagrees.";

beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", "test-key"));
afterEach(() => {
  claudeJson.mockReset();
  vi.unstubAllEnvs();
});

describe("anonymize", () => {
  it("returns the rewritten text and the real replacements", async () => {
    claudeJson.mockResolvedValue({
      ok: true,
      data: {
        text: "Party A thinks pineapple belongs on pizza and Party B disagrees.",
        replacements: [
          { original: "Mark", replacement: "Party A" },
          { original: "Ana", replacement: "Party B" },
          { original: "Party A", replacement: "Party A" },
        ],
      },
    });
    const res = await anonymize(RAW);
    expect(res.text).not.toContain("Mark");
    expect(res.nameMap).toEqual([
      { original: "Mark", replacement: "Party A" },
      { original: "Ana", replacement: "Party B" },
    ]);
  });

  // Never hand back the raw text: it would be judged and stored with the
  // real names in it.
  it.each([
    ["a refusal", { ok: false, blocked: true, reason: "refusal" }],
    ["a quota error", { ok: false, blocked: false, error: "Claude HTTP 429: rate limited" }],
    ["a timeout", { ok: false, blocked: false, error: "Claude request timed out after 60s" }],
    ["empty text", { ok: true, data: { text: "  ", replacements: [] } }],
    ["missing replacements", { ok: true, data: { text: "Party A thinks..." } }],
  ])("throws on %s instead of returning the raw text", async (_label, result) => {
    claudeJson.mockResolvedValue(result);
    await expect(anonymize(RAW)).rejects.toBeInstanceOf(AnonymizeError);
  });

  it("throws without an API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(anonymize(RAW)).rejects.toBeInstanceOf(AnonymizeError);
    expect(claudeJson).not.toHaveBeenCalled();
  });
});
