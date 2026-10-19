import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.hoisted(() => vi.fn());
vi.mock("../lib/claude", () => ({ claudeSearchJson: search }));

import {
  FACTCHECK_SYSTEM,
  FACTCHECK_TIMEOUT_MS,
  factCheckBlock,
  runFactCheck,
  sanitizeFactCheck,
} from "../lib/premium/factcheck";
import type { FactCheck } from "../lib/types";

const RESULTS = new Map([
  ["https://www.nasa.gov/wall", "NASA: the Great Wall from space"],
  ["https://britannica.com/wall/", "Great Wall | Britannica"],
  ["https://example.org/a", "A"],
  ["https://example.org/b", "B"],
  ["https://example.org/c", "C"],
  ["https://example.org/d", "D"],
]);

function claim(overrides: Record<string, unknown> = {}) {
  return {
    claim: "The wall is visible from orbit",
    status: "refuted",
    summary: "Astronauts say it is not visible without aid.",
    sources: [{ title: "NASA", url: "https://www.nasa.gov/wall" }],
    ...overrides,
  };
}

beforeEach(() => {
  search.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("sanitizeFactCheck", () => {
  it("keeps claims whose sources came back from the searches", () => {
    expect(sanitizeFactCheck({ claims: [claim()] }, 1, RESULTS)).toEqual({
      status: "checked",
      claims: [claim()],
    });
  });

  it("drops hallucinated URLs and marks a claim left without sources unverified", () => {
    const fc = sanitizeFactCheck(
      { claims: [claim({ sources: [{ title: "Made up", url: "https://nasa.gov/not-in-results" }] })] },
      2,
      RESULTS,
    );
    expect(fc.status).toBe("checked");
    expect(fc.claims[0].sources).toEqual([]);
    expect(fc.claims[0].status).toBe("unverified");
  });

  it("drops non-http URLs even when they appear in the results", () => {
    const results = new Map([...RESULTS, ["javascript:alert(1)", "x"], ["ftp://example.org/f", "f"]]);
    const fc = sanitizeFactCheck(
      {
        claims: [
          claim({
            sources: [
              { title: "x", url: "javascript:alert(1)" },
              { title: "f", url: "ftp://example.org/f" },
            ],
          }),
        ],
      },
      1,
      results,
    );
    expect(fc.claims[0].sources).toEqual([]);
    expect(fc.claims[0].status).toBe("unverified");
  });

  it("no searches means nothing was checkable", () => {
    expect(sanitizeFactCheck({ claims: [claim()] }, 0, new Map())).toEqual({ status: "none", claims: [] });
    expect(sanitizeFactCheck({ claims: [] }, 0, new Map())).toEqual({ status: "none", claims: [] });
  });

  it("search results without a counted search still count as searched", () => {
    expect(sanitizeFactCheck({ claims: [claim()] }, 0, RESULTS).status).toBe("checked");
  });

  it("a payload that is not the schema is unavailable", () => {
    expect(sanitizeFactCheck(null, 1, RESULTS).status).toBe("unavailable");
    expect(sanitizeFactCheck({ claims: "x" }, 1, RESULTS).status).toBe("unavailable");
    expect(sanitizeFactCheck({ claims: [claim({ status: "true" })] }, 1, RESULTS).status).toBe("unavailable");
    expect(sanitizeFactCheck({ claims: [claim({ summary: 3 })] }, 1, RESULTS).status).toBe("unavailable");
  });

  it("caps at 3 claims and 3 deduped sources per claim", () => {
    const many = [
      { title: "A", url: "https://example.org/a" },
      { title: "A again", url: "https://example.org/a#frag" },
      { title: "B", url: "https://example.org/b" },
      { title: "C", url: "https://example.org/c" },
      { title: "D", url: "https://example.org/d" },
    ];
    const fc = sanitizeFactCheck({ claims: [1, 2, 3, 4].map(() => claim({ sources: many })) }, 3, RESULTS);
    expect(fc.claims).toHaveLength(3);
    expect(fc.claims[0].sources.map((s) => s.url)).toEqual([
      "https://example.org/a",
      "https://example.org/b",
      "https://example.org/c",
    ]);
  });

  it("matches a cited URL that differs only by a trailing slash, keeping the result's URL", () => {
    const fc = sanitizeFactCheck(
      { claims: [claim({ sources: [{ title: "", url: "https://britannica.com/wall" }] })] },
      1,
      RESULTS,
    );
    expect(fc.claims[0].sources).toEqual([{ title: "Great Wall | Britannica", url: "https://britannica.com/wall/" }]);
  });

  it("falls back to the result title and trims long titles to 200 characters", () => {
    const fc = sanitizeFactCheck(
      {
        claims: [
          claim({
            sources: [
              { title: "  ", url: "https://www.nasa.gov/wall" },
              { title: "x".repeat(400), url: "https://example.org/a" },
            ],
          }),
        ],
      },
      1,
      RESULTS,
    );
    expect(fc.claims[0].sources[0].title).toBe("NASA: the Great Wall from space");
    expect(fc.claims[0].sources[1].title.length).toBeLessThanOrEqual(200);
  });

  it("searched but no usable claim reads as nothing checkable", () => {
    expect(sanitizeFactCheck({ claims: [] }, 2, RESULTS)).toEqual({ status: "none", claims: [] });
    expect(sanitizeFactCheck({ claims: [claim({ claim: "  " })] }, 2, RESULTS)).toEqual({ status: "none", claims: [] });
  });
});

describe("factCheckBlock", () => {
  const checked: FactCheck = {
    status: "checked",
    claims: [
      {
        claim: "The wall is visible",
        status: "refuted",
        summary: "It is not.",
        sources: [
          { title: "NASA", url: "https://www.nasa.gov/wall" },
          { title: "B", url: "https://britannica.com/wall/" },
        ],
      },
      { claim: "It is 21,000 km long", status: "unverified", summary: "No source found.", sources: [] },
    ],
  };

  it("renders the numbered evidence block with source domains", () => {
    expect(factCheckBlock(checked)).toBe(
      "FACT-CHECK (web search run before judging; evidence, not a ruling):\n" +
        "1. [refuted] The wall is visible - It is not. (sources: nasa.gov, britannica.com)\n" +
        "2. [unverified] It is 21,000 km long - No source found. (no sources found)",
    );
  });

  it("is null unless something was checked", () => {
    expect(factCheckBlock({ status: "none", claims: [] })).toBeNull();
    expect(factCheckBlock({ status: "unavailable", claims: [] })).toBeNull();
    expect(factCheckBlock({ status: "checked", claims: [] })).toBeNull();
  });
});

describe("runFactCheck", () => {
  it("sends one search call on Haiku at low effort with a bounded budget", async () => {
    search.mockResolvedValue({ ok: true, data: { claims: [claim()] }, searches: 1, results: RESULTS });
    const fc = await runFactCheck("Party A says x; Party B says y.", "en");
    expect(fc.status).toBe("checked");
    const call = search.mock.calls[0][0];
    expect(call).toMatchObject({
      system: FACTCHECK_SYSTEM,
      user: "THE DISPUTE:\n\nParty A says x; Party B says y.",
      model: "claude-haiku-5-5",
      effort: "low",
      timeoutMs: FACTCHECK_TIMEOUT_MS,
      maxSearches: 3,
    });
    expect(call.system).toContain("even when you feel confident");
  });

  it("adds the Turkish language block for tr and honors the env overrides", async () => {
    vi.stubEnv("PREMIUM_FACTCHECK_MODEL", "claude-sonnet-5-5");
    vi.stubEnv("PREMIUM_FACTCHECK_MAX_SEARCHES", "9");
    search.mockResolvedValue({ ok: true, data: { claims: [] }, searches: 0, results: new Map() });
    expect(await runFactCheck("text", "tr")).toEqual({ status: "none", claims: [] });
    const call = search.mock.calls[0][0];
    expect(call.system).toContain('"Taraf A"');
    expect(call.system).toContain('never "siz"');
    expect(call.model).toBe("claude-sonnet-5-5");
    expect(call.maxSearches).toBe(5);
  });

  it("fails open to unavailable on errors, refusals and throws", async () => {
    search.mockResolvedValueOnce({ ok: false, blocked: false, error: "search loop paused (pause_turn)" });
    expect(await runFactCheck("t", "en")).toEqual({ status: "unavailable", claims: [] });
    search.mockResolvedValueOnce({ ok: false, blocked: true, reason: "general_harms" });
    expect(await runFactCheck("t", "en")).toEqual({ status: "unavailable", claims: [] });
    search.mockRejectedValueOnce(new Error("boom"));
    expect(await runFactCheck("t", "en")).toEqual({ status: "unavailable", claims: [] });
  });
});
