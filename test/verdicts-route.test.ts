import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getVerdict = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ getVerdict }));
vi.mock("@/lib/premium/handler", () => ({ clarifyHandler: vi.fn(), premiumVerdict: vi.fn() }));

import * as v1Verdicts from "../app/api/v1/verdicts/[id]/route";
import * as v1Translate from "../app/api/v1/verdicts/[id]/translate/route";
import * as translate from "../app/api/verdict/[id]/translate/route";
import * as v1Verdict from "../app/api/v1/verdict/route";
import * as verdict from "../app/api/verdict/route";
import * as v1Clarify from "../app/api/v1/clarify/route";
import type { VerdictResult } from "../lib/types";

const RESULT: VerdictResult = {
  verdict: "side_b",
  dispute_type: "factual",
  headline: "Party B is right",
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
  confidence: 5,
  runs: ["side_b", "side_b", "side_b"],
  demo: false,
  tier: "premium",
  fact_check: { status: "none", claims: [] },
  panel: { models: ["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
  lang: "en",
};

function get(id: string) {
  return v1Verdicts.GET(new Request(`http://localhost/api/v1/verdicts/${id}`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  getVerdict.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/v1/verdicts/{id}", () => {
  it("returns the stored result and creation time, never the input text", async () => {
    getVerdict.mockResolvedValue({
      id: "abc123",
      input: "Party A says secret things",
      framework: { preset: "balanced" },
      result: RESULT,
      createdAt: "2026-10-19 12:00:00",
    });
    const res = await get("abc123");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: "abc123", result: RESULT, createdAt: "2026-10-19 12:00:00" });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(getVerdict).toHaveBeenCalledWith("abc123");
  });

  it("404 not_found for an unknown id, and for an impossible id without a read", async () => {
    getVerdict.mockResolvedValue(null);
    let res = await get("nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No verdict with that id.", code: "not_found" });
    getVerdict.mockClear();
    res = await get("bad id!");
    expect(res.status).toBe(404);
    expect(getVerdict).not.toHaveBeenCalled();
  });

  it("503 unavailable when the database read fails", async () => {
    getVerdict.mockRejectedValue(new Error("disk"));
    const res = await get("abc123");
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("unavailable");
  });
});

describe("v1 routes", () => {
  it("re-export the unversioned handlers with the same segment config", () => {
    expect(v1Verdict.POST).toBe(verdict.POST);
    expect(v1Verdict.runtime).toBe(verdict.runtime);
    expect(v1Verdict.maxDuration).toBe(verdict.maxDuration);
    expect(v1Translate.POST).toBe(translate.POST);
    expect(v1Translate.runtime).toBe(translate.runtime);
    expect(v1Translate.maxDuration).toBe(translate.maxDuration);
  });

  it("clarify is a Node route with a short budget", () => {
    expect(v1Clarify.runtime).toBe("nodejs");
    expect(v1Clarify.maxDuration).toBe(30);
  });
});
