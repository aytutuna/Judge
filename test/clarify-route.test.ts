import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  calls: [] as string[],
  getViewer: vi.fn(),
  isSameOrigin: vi.fn(),
  authConfigured: vi.fn(),
  getEntitlement: vi.fn(),
  checkUserLimits: vi.fn(),
  claudeJson: vi.fn(),
}));

function track<T extends (...args: never[]) => unknown>(name: string, fn: T) {
  return (...args: Parameters<T>) => {
    m.calls.push(name);
    return fn(...args);
  };
}

vi.mock("@/lib/auth", () => ({
  getViewer: track("viewer", m.getViewer),
  isSameOrigin: track("origin", m.isSameOrigin),
  authConfigured: m.authConfigured,
  // Same rule as lib/auth premiumEnabled, over the mocked authConfigured.
  premiumEnabled: (env: Record<string, string | undefined> = process.env) =>
    env.PREMIUM_ENABLED?.trim() !== "0" && m.authConfigured(env) && Boolean(env.ANTHROPIC_API_KEY),
}));
vi.mock("@/lib/entitlements", () => ({
  getEntitlement: track("entitlement", m.getEntitlement),
  reservePremiumVerdict: vi.fn(),
  consumePremiumVerdict: vi.fn(),
  refundPremiumVerdict: vi.fn(),
}));
vi.mock("@/lib/ratelimit", () => ({
  checkUserLimits: track("userLimits", m.checkUserLimits),
  checkPremiumSiteCap: vi.fn(),
}));
vi.mock("@/lib/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/claude")>()),
  claudeJson: track("model", m.claudeJson),
}));

import { maxDuration, POST } from "../app/api/v1/clarify/route";
import type { Entitlement } from "../lib/account-types";

const ARGUMENT = "Mark says I owe him for dinner; I say we agreed to split it.";
const CAN: Entitlement = { canUsePremium: true, blockedReason: null, credits: 3, subscription: null, resetsAt: null };

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/clarify", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  m.calls.length = 0;
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("PREMIUM_ENABLED", "");
  m.getViewer.mockResolvedValue({ user: { id: "u1", email: "", name: "", image: null }, sessionId: "s", via: "bearer" });
  m.isSameOrigin.mockReturnValue(true);
  m.authConfigured.mockReturnValue(true);
  m.getEntitlement.mockResolvedValue(CAN);
  m.checkUserLimits.mockResolvedValue({ ok: true });
  m.claudeJson.mockResolvedValue({ ok: true, data: { questions: ["Did you agree to split before ordering?"] } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(body.code).toBe(code);
  return body;
}

describe("POST /api/v1/clarify", () => {
  it("has a short function budget", () => {
    expect(maxDuration).toBe(30);
  });

  it("checks session -> limit -> entitlement, then asks, without reserving a credit", async () => {
    const res = await POST(request({ argument: ARGUMENT, lang: "en" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ questions: [{ id: "q1", text: "Did you agree to split before ordering?" }] });
    expect(m.calls).toEqual(["viewer", "userLimits", "entitlement", "model"]);
    expect(m.checkUserLimits).toHaveBeenCalledWith("u1", "clarify");
  });

  it("validates the body first", async () => {
    await expectError(await POST(request("{nope")), 400, "invalid");
    await expectError(await POST(request({ argument: "short" })), 400, "too_short");
    await expectError(await POST(request({ argument: "x".repeat(6001) })), 400, "too_long");
    await expectError(await POST(request({ argument: ARGUMENT, lang: "de" })), 400, "invalid");
    expect(m.calls).toEqual([]);
  });

  it("401 signin_required without a session", async () => {
    m.getViewer.mockResolvedValue(null);
    await expectError(await POST(request({ argument: ARGUMENT })), 401, "signin_required");
    expect(m.calls).toEqual(["viewer"]);
  });

  it("403 bad_origin for a cross-site cookie request", async () => {
    m.getViewer.mockResolvedValue({ user: { id: "u1", email: "", name: "", image: null }, sessionId: "s", via: "cookie" });
    m.isSameOrigin.mockReturnValue(false);
    await expectError(await POST(request({ argument: ARGUMENT })), 403, "bad_origin");
  });

  it("503 not_configured when premium is off", async () => {
    vi.stubEnv("PREMIUM_ENABLED", "0");
    await expectError(await POST(request({ argument: ARGUMENT })), 503, "not_configured");
  });

  it("429 rate_limited from the clarify bucket", async () => {
    m.checkUserLimits.mockResolvedValue({ ok: false, code: "rate_limited", retryAfterSec: 30 });
    const res = await POST(request({ argument: ARGUMENT }));
    expect(res.headers.get("retry-after")).toBe("30");
    await expectError(res, 429, "rate_limited");
    expect(m.claudeJson).not.toHaveBeenCalled();
  });

  it("402 with the entitlement's blocked reason (and resetsAt for fair_use)", async () => {
    m.getEntitlement.mockResolvedValue({ ...CAN, canUsePremium: false, blockedReason: "no_credits", credits: 0 });
    await expectError(await POST(request({ argument: ARGUMENT })), 402, "no_credits");
    m.getEntitlement.mockResolvedValue({
      ...CAN,
      canUsePremium: false,
      blockedReason: "fair_use",
      credits: 0,
      resetsAt: "2026-11-18T00:00:00.000Z",
    });
    const body = await expectError(await POST(request({ argument: ARGUMENT })), 402, "fair_use");
    expect(body.resetsAt).toBe("2026-11-18T00:00:00.000Z");
    m.getEntitlement.mockResolvedValue({ ...CAN, canUsePremium: false, blockedReason: null, credits: 0 });
    await expectError(await POST(request({ argument: ARGUMENT })), 402, "premium_required");
    expect(m.claudeJson).not.toHaveBeenCalled();
  });

  it("fails open to no questions when the model fails", async () => {
    m.claudeJson.mockResolvedValue({ ok: false, blocked: false, error: "Claude request timed out after 20s" });
    const res = await POST(request({ argument: ARGUMENT }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ questions: [] });
  });

  it("503 unavailable when the entitlement cannot be read", async () => {
    m.getEntitlement.mockRejectedValue(new Error("db"));
    await expectError(await POST(request({ argument: ARGUMENT })), 503, "unavailable");
  });
});
