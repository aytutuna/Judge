import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  calls: [] as string[],
  verifyTurnstile: vi.fn(),
  checkVerdictLimits: vi.fn(),
  hasApiKey: vi.fn(),
  anonymize: vi.fn(),
  judgeSelfConsistent: vi.fn(),
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
vi.mock("@/lib/judge", () => ({ judgeSelfConsistent: track("judge", m.judgeSelfConsistent) }));
vi.mock("@/lib/db", () => ({ saveVerdict: track("save", m.saveVerdict) }));

import { maxDuration, POST } from "../app/api/verdict/route";
import type { JudgeRunOutput } from "../lib/types";

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
  m.judgeSelfConsistent.mockResolvedValue([{ ok: true, data: RUN }]);
  m.saveVerdict.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

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
