import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getVerdict = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ getVerdict }));
const getVerdictMeta = vi.hoisted(() => vi.fn());
vi.mock("@/lib/originals/db", () => ({ getVerdictMeta }));
vi.mock("@/lib/originals/removed", () => ({ verdictRemoved: async () => false, roundRoot: async () => null }));
vi.mock("@/lib/premium/handler", () => ({ clarifyHandler: vi.fn(), premiumVerdict: vi.fn() }));
const jobs = vi.hoisted(() => ({
  getVerdictJob: vi.fn(),
  failVerdictJob: vi.fn(),
  maybeSweepVerdictJobs: vi.fn(),
  checkIpLimits: vi.fn(),
}));
vi.mock("@/lib/verdict-jobs", () => ({
  getVerdictJob: jobs.getVerdictJob,
  failVerdictJob: jobs.failVerdictJob,
  maybeSweepVerdictJobs: jobs.maybeSweepVerdictJobs,
  // Same rule as lib/verdict-jobs isStale (10 minutes).
  isStale: (job: { status: string; createdAt: string }, now = new Date()) =>
    job.status === "judging" && job.createdAt < new Date(now.getTime() - 10 * 60_000).toISOString(),
}));
vi.mock("@/lib/ratelimit", () => ({ checkIpLimits: jobs.checkIpLimits }));

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
  jobs.getVerdictJob.mockReset().mockResolvedValue(null);
  jobs.failVerdictJob.mockReset().mockResolvedValue(true);
  jobs.maybeSweepVerdictJobs.mockReset().mockResolvedValue(undefined);
  jobs.checkIpLimits.mockReset().mockResolvedValue({ ok: true });
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
    expect(body).toEqual({ id: "abc123", status: "ready", result: RESULT, createdAt: "2026-10-19 12:00:00", display: null });
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

describe("GET /api/v1/verdicts/{id} for async verdicts", () => {
  const job = (over: Record<string, unknown> = {}) => ({
    id: "job1234567",
    kind: "free",
    status: "judging",
    errorCode: null,
    reservationId: null,
    ownerUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  });

  it("judging: 200 with pollAfterMs and Retry-After, rate limited per IP, no verdict read", async () => {
    jobs.getVerdictJob.mockResolvedValue(job());
    const res = await get("job1234567");
    expect(res.status).toBe(200);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ id: "job1234567", status: "judging", pollAfterMs: 2000 });
    expect(jobs.checkIpLimits).toHaveBeenCalledWith(expect.any(String), "verdict_poll");
    expect(getVerdict).not.toHaveBeenCalled();
  });

  it("failed: 200 with the stable code", async () => {
    jobs.getVerdictJob.mockResolvedValue(job({ status: "failed", errorCode: "quota" }));
    const res = await get("job1234567");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: "job1234567", status: "failed", code: "quota" });
    expect(typeof body.error).toBe("string");
  });

  it("a stale judging job is failed (and refunded) on read", async () => {
    const stale = job({ reservationId: "res1", createdAt: new Date(Date.now() - 11 * 60_000).toISOString() });
    jobs.getVerdictJob.mockResolvedValueOnce(stale).mockResolvedValueOnce({ ...stale, status: "failed", errorCode: "unavailable" });
    const res = await get("job1234567");
    expect(jobs.failVerdictJob).toHaveBeenCalledWith("job1234567", "unavailable", "res1");
    expect(await res.json()).toMatchObject({ status: "failed", code: "unavailable" });
  });

  it("429 with Retry-After when the poll limit is hit; 503 when the limiter is down", async () => {
    jobs.getVerdictJob.mockResolvedValue(job());
    jobs.checkIpLimits.mockResolvedValueOnce({ ok: false, code: "rate_limited", retryAfterSec: 30 });
    let res = await get("job1234567");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect((await res.json()).code).toBe("rate_limited");
    jobs.checkIpLimits.mockResolvedValueOnce({ ok: false, code: "unavailable", error: "x" });
    res = await get("job1234567");
    expect(res.status).toBe(503);
  });

  it("a ready job reads the stored verdict like any other", async () => {
    jobs.getVerdictJob.mockResolvedValue(job({ status: "ready" }));
    getVerdict.mockResolvedValue({ id: "job1234567", input: "x", framework: {}, result: RESULT, createdAt: "t" });
    const res = await get("job1234567");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "job1234567", status: "ready", result: RESULT });
    expect(jobs.checkIpLimits).not.toHaveBeenCalled();
  });

  it("503 when the job read fails", async () => {
    jobs.getVerdictJob.mockRejectedValue(new Error("disk"));
    const res = await get("job1234567");
    expect(res.status).toBe(503);
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
