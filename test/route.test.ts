import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  calls: [] as string[],
  verifyTurnstile: vi.fn(),
  checkVerdictLimits: vi.fn(),
  hasApiKey: vi.fn(),
  anonymize: vi.fn(),
  judgeSelfConsistent: vi.fn(),
  judgeExtra: vi.fn(),
  runCruxTrial: vi.fn(),
  saveVerdict: vi.fn(),
}));

/** Wraps a mock so the call order across modules is recorded. */
function track<T extends (...args: never[]) => unknown>(name: string, fn: T) {
  return (...args: Parameters<T>) => {
    m.calls.push(name);
    return fn(...args);
  };
}

vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: track("turnstile", m.verifyTurnstile) }));
vi.mock("@/lib/ratelimit", () => ({ checkVerdictLimits: track("limits", m.checkVerdictLimits) }));
vi.mock("@/lib/claude", () => ({ hasApiKey: track("key", m.hasApiKey) }));
vi.mock("@/lib/anonymize", () => ({ anonymize: track("anonymize", m.anonymize) }));
vi.mock("@/lib/judge", () => ({
  judgeSelfConsistent: track("judge", m.judgeSelfConsistent),
  judgeExtra: track("extra", m.judgeExtra),
}));
// Only the model call is mocked: shouldTryCrux and applyCruxTrial stay real.
vi.mock("@/lib/trial", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/trial")>()),
  runCruxTrial: track("trial", m.runCruxTrial),
}));
vi.mock("@/lib/db", () => ({ saveVerdict: track("save", m.saveVerdict) }));

import { maxDuration, POST } from "../app/api/verdict/route";
import type { JudgeRunOutput, JudgeVerdict, VerdictResult } from "../lib/types";

const ARGUMENT = "Mark says the Great Wall is visible from space with the naked eye; I say it is not.";

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/verdict", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const RUN: JudgeRunOutput = {
  verdict: "side_b",
  dispute_type: "values",
  headline: "Party B is right",
  crux: "Whether it is visible",
  split_points: null,
  conditional: null,
  argument_map: {
    side_a: [{ claim: "It is visible", kind: "fact" }],
    side_b: [{ claim: "It is not", kind: "fact" }],
    bedrock_a: "a",
    bedrock_b: "b",
  },
  facts_relied_on: [],
  losing_side_best_point: "It is long",
  leaning: "side_b",
  leaning_reason: "Astronaut accounts",
};

beforeEach(() => {
  m.calls.length = 0;
  m.verifyTurnstile.mockResolvedValue("ok");
  m.checkVerdictLimits.mockResolvedValue({ ok: true });
  m.hasApiKey.mockReturnValue(true);
  m.anonymize.mockResolvedValue({
    text: "Party A says the Great Wall is visible from space with the naked eye; Party B says it is not.",
    nameMap: [{ original: "Mark", replacement: "Party A" }],
  });
  // Three agreeing runs: confidence 5, so the default path never escalates.
  m.judgeSelfConsistent.mockResolvedValue([ok(RUN), ok(RUN), ok(RUN)]);
  m.judgeExtra.mockResolvedValue([]);
  m.runCruxTrial.mockResolvedValue(null);
  m.saveVerdict.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function ok(data: JudgeRunOutput) {
  return { ok: true as const, data };
}

function vote(verdict: JudgeVerdict, overrides: Partial<JudgeRunOutput> = {}): JudgeRunOutput {
  const leaning = verdict === "side_a" ? "side_a" : "side_b";
  return { ...RUN, verdict, leaning, ...overrides };
}

const FAILED = { ok: false as const, blocked: false, error: "Claude HTTP 529: overloaded" };

async function verdictOf(res: Response): Promise<VerdictResult> {
  expect(res.status).toBe(200);
  return ((await res.json()) as { result: VerdictResult }).result;
}

describe("POST /api/verdict", () => {
  it("allows a long-running function on Vercel", () => {
    expect(maxDuration).toBe(300);
  });

  it("runs turnstile -> limits -> key -> anonymize -> judge -> save, storing only anonymized text", async () => {
    const res = await POST(
      request({ argument: ARGUMENT, turnstileToken: "tok" }, { "x-forwarded-for": "203.0.113.5, 10.0.0.1" }),
    );
    expect(res.status).toBe(200);
    expect(m.calls).toEqual(["turnstile", "limits", "key", "anonymize", "judge", "save"]);
    expect(m.verifyTurnstile).toHaveBeenCalledWith("tok", "203.0.113.5");
    expect(m.checkVerdictLimits).toHaveBeenCalledWith("203.0.113.5");
    const saved = m.saveVerdict.mock.calls[0][0];
    expect(saved.input).not.toContain("Mark");
    const body = await res.json();
    expect(body.id).toBe(saved.id);
    expect(body.name_map).toEqual([{ original: "Mark", replacement: "Party A" }]);
  });

  it("validates the body before anything else", async () => {
    const res = await POST(request({ argument: "too short" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("too_short");
    expect(m.calls).toEqual([]);
  });

  it("refuses a failed bot check with 403 before touching the limits", async () => {
    m.verifyTurnstile.mockResolvedValue("invalid");
    const res = await POST(request({ argument: ARGUMENT }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("captcha_failed");
    expect(m.calls).toEqual(["turnstile"]);
    expect(m.verifyTurnstile).toHaveBeenCalledWith(undefined, "unknown");
  });

  it("reports an unreachable bot check as unavailable", async () => {
    m.verifyTurnstile.mockResolvedValue("error");
    const res = await POST(request({ argument: ARGUMENT, turnstileToken: "tok" }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("unavailable");
    expect(m.calls).toEqual(["turnstile"]);
  });

  it("returns 429 rate_limited with retryAfterSec before any model call", async () => {
    m.checkVerdictLimits.mockResolvedValue({ ok: false, code: "rate_limited", retryAfterSec: 120 });
    const res = await POST(request({ argument: ARGUMENT }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("120");
    expect(await res.json()).toMatchObject({ code: "rate_limited", retryAfterSec: 120 });
    expect(m.calls).toEqual(["turnstile", "limits"]);
  });

  it("returns 503 daily_cap with retryAfterSec", async () => {
    m.checkVerdictLimits.mockResolvedValue({ ok: false, code: "daily_cap", retryAfterSec: 3600 });
    const res = await POST(request({ argument: ARGUMENT }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "daily_cap", retryAfterSec: 3600 });
    expect(m.calls).toEqual(["turnstile", "limits"]);
  });

  it("fails closed when the limiter store is down", async () => {
    m.checkVerdictLimits.mockResolvedValue({ ok: false, code: "unavailable", error: "redis down" });
    const res = await POST(request({ argument: ARGUMENT }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("unavailable");
    expect(m.calls).toEqual(["turnstile", "limits"]);
  });

  it("refuses without an API key after the limits", async () => {
    m.hasApiKey.mockReturnValue(false);
    const res = await POST(request({ argument: ARGUMENT }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("not_configured");
    expect(m.calls).toEqual(["turnstile", "limits", "key"]);
  });

  it("neither judges nor stores the raw text when anonymization fails", async () => {
    m.anonymize.mockRejectedValue(new Error("Claude HTTP 429: rate limited"));
    const res = await POST(request({ argument: ARGUMENT }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("unavailable");
    expect(m.judgeSelfConsistent).not.toHaveBeenCalled();
    expect(m.saveVerdict).not.toHaveBeenCalled();
  });

  it("returns unavailable JSON when saving fails", async () => {
    m.saveVerdict.mockRejectedValue(new Error("disk full"));
    const res = await POST(request({ argument: ARGUMENT }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("unavailable");
  });
});

describe("POST /api/verdict escalation", () => {
  // 2 of 3 for side_b with an opposite-side dissenter: confidence 2.
  const LOW = [ok(vote("side_b")), ok(vote("side_b")), ok(vote("side_a"))];

  it("calls in two extra judges in one parallel round at confidence 2 and counts every vote", async () => {
    m.judgeSelfConsistent.mockResolvedValue(LOW);
    m.judgeExtra.mockResolvedValue([ok(vote("side_b")), ok(vote("side_b"))]);
    const result = await verdictOf(await POST(request({ argument: ARGUMENT, lang: "tr" })));
    expect(m.judgeExtra).toHaveBeenCalledTimes(1);
    const [n, text, framework, lang] = m.judgeExtra.mock.calls[0];
    expect(n).toBe(2);
    expect(text).not.toContain("Mark");
    expect(framework).toEqual({ preset: "balanced" });
    expect(lang).toBe("tr");
    expect(result.runs).toEqual(["side_b", "side_b", "side_a", "side_b", "side_b"]);
    // 4/5 with an opposite dissenter.
    expect(result.confidence).toBe(3);
    expect(result.escalated).toBe(true);
    expect(m.saveVerdict.mock.calls[0][0].result.escalated).toBe(true);
    expect(m.calls).toEqual(["turnstile", "limits", "key", "anonymize", "judge", "extra", "save"]);
  });

  it("escalates a too_close (confidence 1) first round", async () => {
    m.judgeSelfConsistent.mockResolvedValue([
      ok(vote("side_a")),
      ok(vote("side_b")),
      ok(vote("dissolved")),
    ]);
    m.judgeExtra.mockResolvedValue([ok(vote("side_b")), ok(vote("side_b"))]);
    const result = await verdictOf(await POST(request({ argument: ARGUMENT })));
    expect(result.verdict).toBe("side_b");
    expect(result.runs).toHaveLength(5);
    expect(result.escalated).toBe(true);
  });

  it("does not escalate at confidence 3 or above", async () => {
    m.judgeSelfConsistent.mockResolvedValue([ok(vote("side_b")), ok(vote("side_b")), ok(vote("split"))]);
    const result = await verdictOf(await POST(request({ argument: ARGUMENT })));
    expect(result.confidence).toBe(3);
    expect(m.judgeExtra).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("escalated");
    expect(console.info).not.toHaveBeenCalled();
  });

  it("keeps the first result when every extra run fails", async () => {
    m.judgeSelfConsistent.mockResolvedValue(LOW);
    m.judgeExtra.mockResolvedValue([FAILED, FAILED]);
    const result = await verdictOf(await POST(request({ argument: ARGUMENT })));
    expect(result.runs).toEqual(["side_b", "side_b", "side_a"]);
    expect(result.confidence).toBe(2);
    expect(result).not.toHaveProperty("escalated");
  });

  it("fails open if the extra round rejects outright", async () => {
    m.judgeSelfConsistent.mockResolvedValue(LOW);
    m.judgeExtra.mockRejectedValue(new Error("boom"));
    const result = await verdictOf(await POST(request({ argument: ARGUMENT })));
    expect(result.runs).toHaveLength(3);
    expect(result.confidence).toBe(2);
  });

  it("counts the extra runs that did succeed", async () => {
    m.judgeSelfConsistent.mockResolvedValue(LOW);
    m.judgeExtra.mockResolvedValue([FAILED, ok(vote("side_b"))]);
    const result = await verdictOf(await POST(request({ argument: ARGUMENT })));
    expect(result.runs).toHaveLength(4);
    // 3/4 with an opposite dissenter.
    expect(result.confidence).toBe(2);
    expect(result.escalated).toBe(true);
  });

  it("is off when JUDGE_EXTRA_RUNS=0", async () => {
    vi.stubEnv("JUDGE_EXTRA_RUNS", "0");
    m.judgeSelfConsistent.mockResolvedValue(LOW);
    const result = await verdictOf(await POST(request({ argument: ARGUMENT })));
    expect(m.judgeExtra).not.toHaveBeenCalled();
    expect(result.runs).toHaveLength(3);
  });

  it("clamps JUDGE_EXTRA_RUNS to 4 and honors JUDGE_ESCALATE_AT", async () => {
    vi.stubEnv("JUDGE_EXTRA_RUNS", "9");
    vi.stubEnv("JUDGE_ESCALATE_AT", "3");
    m.judgeSelfConsistent.mockResolvedValue([ok(vote("side_b")), ok(vote("side_b")), ok(vote("split"))]);
    await verdictOf(await POST(request({ argument: ARGUMENT })));
    expect(m.judgeExtra.mock.calls[0][0]).toBe(4);
  });

  it("runs the crux trial on the escalated result", async () => {
    const factual = (v: JudgeVerdict) => vote(v, { dispute_type: "factual" });
    m.judgeSelfConsistent.mockResolvedValue([
      ok(factual("side_b")),
      ok(factual("side_b")),
      ok(factual("side_a")),
    ]);
    m.judgeExtra.mockResolvedValue([ok(factual("side_b")), ok(factual("side_b"))]);
    m.runCruxTrial.mockResolvedValue({ attack: "atk", outcome: "uncertain", reasoning: "r" });
    const result = await verdictOf(await POST(request({ argument: ARGUMENT })));
    expect(m.calls).toEqual(["turnstile", "limits", "key", "anonymize", "judge", "extra", "trial", "save"]);
    const tried: VerdictResult = m.runCruxTrial.mock.calls[0][1];
    expect(tried.runs).toHaveLength(5);
    expect(tried.confidence).toBe(3);
    expect(tried.escalated).toBe(true);
    expect(result.crux_trial?.outcome).toBe("uncertain");
    expect(result.escalated).toBe(true);
  });

  it("logs one line with counts only", async () => {
    m.judgeSelfConsistent.mockResolvedValue(LOW);
    m.judgeExtra.mockResolvedValue([ok(vote("side_b")), FAILED]);
    await verdictOf(await POST(request({ argument: ARGUMENT })));
    expect(console.info).toHaveBeenCalledTimes(1);
    const line = String(vi.mocked(console.info).mock.calls[0][0]);
    expect(line).toBe("[verdict] escalated at confidence 2: 1/2 extra runs ok, 4 runs counted");
  });
});
