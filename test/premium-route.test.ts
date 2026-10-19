import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  calls: [] as string[],
  getViewer: vi.fn(),
  isSameOrigin: vi.fn(),
  authConfigured: vi.fn(),
  reservePremiumVerdict: vi.fn(),
  consumePremiumVerdict: vi.fn(),
  refundPremiumVerdict: vi.fn(),
  getEntitlement: vi.fn(),
  checkVerdictLimits: vi.fn(),
  checkUserLimits: vi.fn(),
  checkPremiumSiteCap: vi.fn(),
  verifyTurnstile: vi.fn(),
  hasApiKey: vi.fn(),
  anonymize: vi.fn(),
  judgeSelfConsistent: vi.fn(),
  judgeExtra: vi.fn(),
  runCruxTrial: vi.fn(),
  saveVerdict: vi.fn(),
  getVerdict: vi.fn(),
  runFactCheck: vi.fn(),
  judgePremiumPanel: vi.fn(),
}));

/** Wraps a mock so the call order across modules is recorded. */
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
  reservePremiumVerdict: track("reserve", m.reservePremiumVerdict),
  consumePremiumVerdict: track("consume", m.consumePremiumVerdict),
  refundPremiumVerdict: track("refund", m.refundPremiumVerdict),
  getEntitlement: track("entitlement", m.getEntitlement),
}));
vi.mock("@/lib/ratelimit", () => ({
  checkVerdictLimits: track("limits", m.checkVerdictLimits),
  checkUserLimits: track("userLimits", m.checkUserLimits),
  checkPremiumSiteCap: track("siteCap", m.checkPremiumSiteCap),
}));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: track("turnstile", m.verifyTurnstile) }));
vi.mock("@/lib/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/claude")>()),
  hasApiKey: track("key", m.hasApiKey),
}));
vi.mock("@/lib/anonymize", () => ({ anonymize: track("anonymize", m.anonymize) }));
vi.mock("@/lib/judge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/judge")>()),
  judgeSelfConsistent: track("judge", m.judgeSelfConsistent),
  judgeExtra: track("extra", m.judgeExtra),
}));
vi.mock("@/lib/trial", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/trial")>()),
  runCruxTrial: track("trial", m.runCruxTrial),
}));
vi.mock("@/lib/db", () => ({
  saveVerdict: track("save", m.saveVerdict),
  getVerdict: track("getVerdict", m.getVerdict),
}));
vi.mock("@/lib/premium/factcheck", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/premium/factcheck")>()),
  runFactCheck: track("factcheck", m.runFactCheck),
}));
vi.mock("@/lib/premium/panel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/premium/panel")>()),
  judgePremiumPanel: track("panel", m.judgePremiumPanel),
}));

import { POST } from "../app/api/verdict/route";
import { POST as POST_V1 } from "../app/api/v1/verdict/route";
import { ESCALATION_CUTOFF_MS, TRIAL_CUTOFF_MS } from "../lib/premium/run";
import type { Entitlement } from "../lib/account-types";
import type { FactCheck, JudgeRunOutput, JudgeVerdict, VerdictResult } from "../lib/types";

const ARGUMENT = "Mark says the Great Wall is visible from space with the naked eye; I say it is not.";
const ANON = "Party A says the Great Wall is visible from space with the naked eye; Party B says it is not.";

const ENTITLEMENT: Entitlement = {
  canUsePremium: true,
  blockedReason: null,
  credits: 4,
  subscription: null,
  resetsAt: null,
};

const FACTS: FactCheck = {
  status: "checked",
  claims: [
    {
      claim: "The Great Wall is visible from space with the naked eye",
      status: "refuted",
      summary: "Astronauts report it is not visible without aid.",
      sources: [{ title: "NASA", url: "https://www.nasa.gov/wall" }],
    },
  ],
};

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

function ok(data: JudgeRunOutput) {
  return { ok: true as const, data };
}
function vote(verdict: JudgeVerdict, overrides: Partial<JudgeRunOutput> = {}): JudgeRunOutput {
  return { ...RUN, verdict, leaning: verdict === "side_a" ? "side_a" : "side_b", ...overrides };
}
const FAILED = { ok: false as const, blocked: false, error: "Claude HTTP 529: overloaded" };
const BLOCKED = { ok: false as const, blocked: true, error: "model refused (general_harms)" };
const PANEL_MODELS = ["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

function request(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
  url = "http://localhost/api/verdict",
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const premium = (extra: Record<string, unknown> = {}) => ({ argument: ARGUMENT, tier: "premium", ...extra });

/** The call order without the bookkeeping reads that may happen anywhere. */
function steps(): string[] {
  return m.calls.filter((c) => c !== "entitlement");
}

let clock = 1_000_000;

beforeEach(() => {
  m.calls.length = 0;
  clock = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("PREMIUM_ENABLED", "");
  m.getViewer.mockResolvedValue({
    user: { id: "u1", email: "a@b.c", name: "A", image: null },
    sessionId: "s1",
    via: "bearer",
  });
  m.isSameOrigin.mockReturnValue(true);
  m.authConfigured.mockReturnValue(true);
  m.checkUserLimits.mockResolvedValue({ ok: true });
  m.checkPremiumSiteCap.mockResolvedValue({ ok: true });
  m.reservePremiumVerdict.mockResolvedValue({ ok: true, reservation: { id: "r1", fundedBy: "credits" } });
  m.consumePremiumVerdict.mockResolvedValue(undefined);
  m.refundPremiumVerdict.mockResolvedValue(undefined);
  m.getEntitlement.mockResolvedValue(ENTITLEMENT);
  m.checkVerdictLimits.mockResolvedValue({ ok: true });
  m.verifyTurnstile.mockResolvedValue("ok");
  m.hasApiKey.mockReturnValue(true);
  m.anonymize.mockResolvedValue({ text: ANON, nameMap: [{ original: "Mark", replacement: "Party A" }] });
  m.judgeSelfConsistent.mockResolvedValue([ok(RUN), ok(RUN), ok(RUN)]);
  m.judgeExtra.mockResolvedValue([]);
  m.runCruxTrial.mockResolvedValue(null);
  m.saveVerdict.mockResolvedValue(undefined);
  m.getVerdict.mockResolvedValue(null);
  m.runFactCheck.mockResolvedValue(FACTS);
  m.judgePremiumPanel.mockResolvedValue({ runs: [ok(RUN), ok(RUN), ok(RUN)], models: PANEL_MODELS });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("free requests stay on the free path", () => {
  it("never touches auth, entitlements, user limits or the premium pipeline", async () => {
    for (const body of [{ argument: ARGUMENT }, { argument: ARGUMENT, tier: "free" }]) {
      m.calls.length = 0;
      const res = await POST(request({ ...body, clarifications: [{ question: "Q?", answer: "Bob" }] }));
      expect(res.status).toBe(200);
      expect(m.calls).toEqual(["turnstile", "limits", "key", "anonymize", "judge", "save"]);
    }
    for (const fn of [
      m.getViewer,
      m.reservePremiumVerdict,
      m.checkUserLimits,
      m.checkPremiumSiteCap,
      m.runFactCheck,
      m.judgePremiumPanel,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
    // Clarifications are ignored on free: the argument is anonymized as sent.
    expect(m.anonymize).toHaveBeenCalledWith(ARGUMENT);
  });

  it("free results carry no tier, fact_check or panel and the response has no entitlement", async () => {
    const res = await POST(request({ argument: ARGUMENT }));
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["id", "name_map", "result"]);
    for (const key of ["tier", "fact_check", "panel"]) expect(body.result).not.toHaveProperty(key);
    expect(m.saveVerdict.mock.calls[0][0].result).not.toHaveProperty("tier");
  });

  it("an unknown tier is a 400 before anything else", async () => {
    const res = await POST(request({ argument: ARGUMENT, tier: "gold" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid");
    expect(m.calls).toEqual([]);
  });
});

describe("premium verdict: success", () => {
  it("runs the gates in order, then anonymize -> fact-check -> panel -> save -> consume", async () => {
    const res = await POST(request(premium(), { "idempotency-key": "abc-123" }));
    expect(res.status).toBe(200);
    expect(steps()).toEqual([
      "viewer",
      "userLimits",
      "siteCap",
      "reserve",
      "anonymize",
      "factcheck",
      "panel",
      "save",
      "consume",
    ]);
    expect(m.checkUserLimits).toHaveBeenCalledWith("u1", "premium_verdict");
    expect(m.reservePremiumVerdict).toHaveBeenCalledWith("u1", { idempotencyKey: "abc-123" });
    expect(m.verifyTurnstile).not.toHaveBeenCalled();
    expect(m.checkVerdictLimits).not.toHaveBeenCalled();
    expect(m.consumePremiumVerdict).toHaveBeenCalledTimes(1);
    expect(m.refundPremiumVerdict).not.toHaveBeenCalled();

    const body = await res.json();
    const saved = m.saveVerdict.mock.calls[0][0];
    expect(m.consumePremiumVerdict).toHaveBeenCalledWith("r1", saved.id);
    expect(body.id).toBe(saved.id);
    expect(body.entitlement).toEqual(ENTITLEMENT);
    expect(body.name_map).toEqual([{ original: "Mark", replacement: "Party A" }]);
    const result: VerdictResult = body.result;
    expect(result.tier).toBe("premium");
    expect(result.fact_check).toEqual(FACTS);
    expect(result.panel).toEqual({ models: PANEL_MODELS });
    expect(result.panel!.models).toHaveLength(result.runs.length);
    expect(result.lang).toBe("en");
    expect(saved.input).toBe(ANON);
    expect(saved.result).toEqual(result);
  });

  it("passes the fact-check block to the panel and the anonymized text to the fact-check", async () => {
    await POST(request(premium({ lang: "tr", framework: { preset: "balanced" } })));
    expect(m.runFactCheck).toHaveBeenCalledWith(ANON, "tr");
    const [text, framework, lang, context] = m.judgePremiumPanel.mock.calls[0];
    expect(text).toBe(ANON);
    expect(framework).toEqual({ preset: "balanced" });
    expect(lang).toBe("tr");
    expect(context).toMatch(/^FACT-CHECK \(web search run before judging; evidence, not a ruling\):\n1\. \[refuted\]/);
    expect(context).toContain("(sources: nasa.gov)");
  });

  it("gives the panel no context when nothing was checked", async () => {
    m.runFactCheck.mockResolvedValue({ status: "none", claims: [] });
    const result: VerdictResult = (await (await POST(request(premium()))).json()).result;
    expect(m.judgePremiumPanel.mock.calls[0][3]).toBeNull();
    expect(result.fact_check).toEqual({ status: "none", claims: [] });
  });

  it("anonymizes the clarification answers together with the argument, dropping skipped ones", async () => {
    await POST(
      request(
        premium({
          clarifications: [
            { question: "Did Mark see it himself?", answer: "No, Mark read it online" },
            { question: "When was this?", answer: "  " },
          ],
        }),
      ),
    );
    expect(m.anonymize).toHaveBeenCalledWith(
      `${ARGUMENT}\n\nMore details from the person asking:\n- Q: Did Mark see it himself?\n  A: No, Mark read it online`,
    );
  });

  it("is reachable through /api/v1/verdict with the same handler", async () => {
    const res = await POST_V1(request(premium(), {}, "http://localhost/api/v1/verdict"));
    expect(res.status).toBe(200);
    expect((await res.json()).result.tier).toBe("premium");
  });

  it("logs one line per verdict with counts only", async () => {
    await POST(request(premium()));
    const lines = vi.mocked(console.info).mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[premium]"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\[premium\] verdict id=\S+ outcome=ok fact_check=checked claims=1 escalated=0 trial=0 ms=\d+ calls=\d+ in=\d+ out=\d+ total=\d+ searches=\d+ models=\S+$/,
    );
    expect(lines[0]).not.toContain("Mark");
    expect(lines[0]).not.toContain("Party");
  });
});

describe("premium verdict: gates and error codes", () => {
  async function expectError(res: Response, status: number, code: string) {
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.code).toBe(code);
    expect(typeof body.error).toBe("string");
    return body;
  }

  it("400 invalid for a malformed Idempotency-Key, before the session lookup", async () => {
    await expectError(await POST(request(premium(), { "idempotency-key": "bad key!" })), 400, "invalid");
    expect(m.calls).toEqual([]);
  });

  it("400 too_short / too_long like the free path", async () => {
    await expectError(await POST(request({ argument: "short", tier: "premium" })), 400, "too_short");
    await expectError(await POST(request({ argument: "x".repeat(6001), tier: "premium" })), 400, "too_long");
    expect(m.calls).toEqual([]);
  });

  it("400 invalid for more than two clarifications", async () => {
    const c = { question: "Q?", answer: "A" };
    await expectError(await POST(request(premium({ clarifications: [c, c, c] }))), 400, "invalid");
  });

  it("401 signin_required without a session", async () => {
    m.getViewer.mockResolvedValue(null);
    await expectError(await POST(request(premium())), 401, "signin_required");
    expect(m.calls).toEqual(["viewer"]);
  });

  it("403 bad_origin for a cookie session from another origin; bearer is exempt", async () => {
    m.getViewer.mockResolvedValue({ user: { id: "u1", email: "", name: "", image: null }, sessionId: "s", via: "cookie" });
    m.isSameOrigin.mockReturnValue(false);
    await expectError(await POST(request(premium())), 403, "bad_origin");
    expect(m.calls).toEqual(["viewer", "origin"]);

    m.calls.length = 0;
    m.getViewer.mockResolvedValue({ user: { id: "u1", email: "", name: "", image: null }, sessionId: "s", via: "bearer" });
    expect((await POST(request(premium()))).status).toBe(200);
    expect(m.calls).not.toContain("origin");
  });

  it("503 not_configured when premium is off, auth is unconfigured or the key is missing", async () => {
    vi.stubEnv("PREMIUM_ENABLED", "0");
    await expectError(await POST(request(premium())), 503, "not_configured");
    vi.stubEnv("PREMIUM_ENABLED", "");
    m.authConfigured.mockReturnValue(false);
    await expectError(await POST(request(premium())), 503, "not_configured");
    m.authConfigured.mockReturnValue(true);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expectError(await POST(request(premium())), 503, "not_configured");
    expect(m.reservePremiumVerdict).not.toHaveBeenCalled();
  });

  it("429 rate_limited with retryAfterSec from the per-user limit", async () => {
    m.checkUserLimits.mockResolvedValue({ ok: false, code: "rate_limited", retryAfterSec: 90 });
    const res = await POST(request(premium()));
    expect(res.headers.get("retry-after")).toBe("90");
    expect(await expectError(res, 429, "rate_limited")).toMatchObject({ retryAfterSec: 90 });
    expect(m.calls).toEqual(["viewer", "userLimits"]);
  });

  it("503 daily_cap from the site-wide premium cap", async () => {
    m.checkPremiumSiteCap.mockResolvedValue({ ok: false, code: "daily_cap", retryAfterSec: 3600 });
    expect(await expectError(await POST(request(premium())), 503, "daily_cap")).toMatchObject({ retryAfterSec: 3600 });
    expect(m.reservePremiumVerdict).not.toHaveBeenCalled();
  });

  it("503 unavailable when the limiter fails (closed)", async () => {
    m.checkUserLimits.mockResolvedValue({ ok: false, code: "unavailable", error: "redis down" });
    await expectError(await POST(request(premium())), 503, "unavailable");
    m.checkUserLimits.mockRejectedValue(new Error("boom"));
    await expectError(await POST(request(premium())), 503, "unavailable");
    expect(m.reservePremiumVerdict).not.toHaveBeenCalled();
  });

  it.each([
    ["premium_required", undefined],
    ["no_credits", undefined],
    ["fair_use", "2026-11-18T00:00:00.000Z"],
  ])("402 %s from the reservation", async (code, resetsAt) => {
    m.reservePremiumVerdict.mockResolvedValue({ ok: false, code, ...(resetsAt ? { resetsAt } : {}) });
    const body = await expectError(await POST(request(premium())), 402, code);
    if (resetsAt) expect(body.resetsAt).toBe(resetsAt);
    else expect(body).not.toHaveProperty("resetsAt");
    expect(m.anonymize).not.toHaveBeenCalled();
    expect(m.refundPremiumVerdict).not.toHaveBeenCalled();
  });

  it("409 in_progress while the same Idempotency-Key is still reserved", async () => {
    m.reservePremiumVerdict.mockResolvedValue({ ok: false, code: "in_progress" });
    await expectError(await POST(request(premium(), { "idempotency-key": "k1" })), 409, "in_progress");
    expect(m.anonymize).not.toHaveBeenCalled();
  });

  it("replays a finished verdict for the same Idempotency-Key without charging", async () => {
    const stored: VerdictResult = { ...RUN, verdict: "side_b", confidence: 5, runs: ["side_b"], demo: false, tier: "premium" };
    m.reservePremiumVerdict.mockResolvedValue({ ok: false, code: "replay", verdictId: "v123" });
    m.getVerdict.mockResolvedValue({ id: "v123", input: ANON, framework: { preset: "balanced" }, result: stored, createdAt: "x" });
    const res = await POST(request(premium(), { "idempotency-key": "k1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: "v123", result: stored, name_map: [], replayed: true, entitlement: ENTITLEMENT });
    expect(body).not.toHaveProperty("input");
    expect(m.anonymize).not.toHaveBeenCalled();
    expect(m.consumePremiumVerdict).not.toHaveBeenCalled();
  });

  it("503 unavailable when the reservation itself fails", async () => {
    m.reservePremiumVerdict.mockRejectedValue(new Error("SQLITE_BUSY"));
    await expectError(await POST(request(premium())), 503, "unavailable");
    expect(m.refundPremiumVerdict).not.toHaveBeenCalled();
  });
});

describe("premium verdict: refunds", () => {
  it("refunds when anonymization fails, without judging or storing", async () => {
    m.anonymize.mockRejectedValue(new Error("Claude HTTP 529"));
    const res = await POST(request(premium()));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("unavailable");
    expect(m.refundPremiumVerdict).toHaveBeenCalledWith("r1");
    expect(m.runFactCheck).not.toHaveBeenCalled();
    expect(m.saveVerdict).not.toHaveBeenCalled();
    expect(m.consumePremiumVerdict).not.toHaveBeenCalled();
  });

  it("refunds when every run failed (502 unavailable, or quota on HTTP 429)", async () => {
    m.judgePremiumPanel.mockResolvedValue({ runs: [FAILED, FAILED, FAILED], models: [] });
    let res = await POST(request(premium()));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("unavailable");
    m.judgePremiumPanel.mockResolvedValue({
      runs: [{ ok: false, blocked: false, error: "Claude HTTP 429: rate" }, FAILED, FAILED],
      models: [],
    });
    res = await POST(request(premium()));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("quota");
    expect(m.refundPremiumVerdict).toHaveBeenCalledTimes(2);
    expect(m.saveVerdict).not.toHaveBeenCalled();
  });

  it("returns the refused result (200), stores it and refunds when every judge declined", async () => {
    m.judgePremiumPanel.mockResolvedValue({ runs: [BLOCKED, BLOCKED, BLOCKED], models: [] });
    const res = await POST(request(premium()));
    expect(res.status).toBe(200);
    const result: VerdictResult = (await res.json()).result;
    expect(result.model_refused).toBe(true);
    expect(result.tier).toBe("premium");
    expect(result.panel).toEqual({ models: [] });
    expect(m.saveVerdict).toHaveBeenCalledTimes(1);
    expect(m.refundPremiumVerdict).toHaveBeenCalledWith("r1");
    expect(m.consumePremiumVerdict).not.toHaveBeenCalled();
  });

  it("refunds when saving fails", async () => {
    m.saveVerdict.mockRejectedValue(new Error("disk full"));
    const res = await POST(request(premium()));
    expect(res.status).toBe(503);
    expect(m.refundPremiumVerdict).toHaveBeenCalledTimes(1);
    expect(m.consumePremiumVerdict).not.toHaveBeenCalled();
  });

  it("refunds on an unexpected throw", async () => {
    m.judgePremiumPanel.mockRejectedValue(new Error("boom"));
    const res = await POST(request(premium()));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("unavailable");
    expect(m.refundPremiumVerdict).toHaveBeenCalledTimes(1);
  });

  it("never refunds a consumed reservation, even if a later read fails", async () => {
    m.getEntitlement.mockRejectedValue(new Error("db gone"));
    const res = await POST(request(premium()));
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty("entitlement");
    expect(m.consumePremiumVerdict).toHaveBeenCalledTimes(1);
    expect(m.refundPremiumVerdict).not.toHaveBeenCalled();
  });

  it("shows but does not charge a verdict where every Sonnet seat failed and only Haiku judged", async () => {
    m.judgePremiumPanel.mockResolvedValue({ runs: [FAILED, FAILED, ok(RUN)], models: ["claude-haiku-5-5"] });
    const res = await POST(request(premium()));
    expect(res.status).toBe(200);
    const result: VerdictResult = (await res.json()).result;
    expect(result.tier).toBe("premium");
    expect(result.panel!.models).toEqual(["claude-haiku-5-5"]);
    expect(m.saveVerdict).toHaveBeenCalledTimes(1);
    expect(m.refundPremiumVerdict).toHaveBeenCalledWith("r1");
    expect(m.consumePremiumVerdict).not.toHaveBeenCalled();
    const line = vi.mocked(console.info).mock.calls.map(([l]) => String(l)).find((l) => l.startsWith("[premium] verdict"));
    expect(line).toMatch(/outcome=degraded/);
  });

  it("does not charge when refused Sonnet seats were all served by Haiku", async () => {
    m.judgePremiumPanel.mockResolvedValue({
      runs: [ok(RUN), ok(RUN), ok(RUN)],
      models: ["claude-haiku-5-5", "claude-haiku-5-5", "claude-haiku-5-5"],
    });
    expect((await POST(request(premium()))).status).toBe(200);
    expect(m.refundPremiumVerdict).toHaveBeenCalledWith("r1");
    expect(m.consumePremiumVerdict).not.toHaveBeenCalled();
  });

  it("still does not charge when escalation adds Haiku runs to a Haiku-only panel", async () => {
    m.judgePremiumPanel.mockResolvedValue({ runs: [FAILED, FAILED, ok(RUN)], models: ["claude-haiku-5-5"] });
    m.judgeExtra.mockResolvedValue([ok(RUN), ok(RUN)]);
    const result: VerdictResult = (await (await POST(request(premium()))).json()).result;
    expect(result.escalated).toBe(true);
    expect(m.consumePremiumVerdict).not.toHaveBeenCalled();
    expect(m.refundPremiumVerdict).toHaveBeenCalledTimes(1);
  });

  it("charges when at least one Sonnet seat judged", async () => {
    m.judgePremiumPanel.mockResolvedValue({
      runs: [ok(RUN), FAILED, ok(RUN)],
      models: ["claude-sonnet-5-5", "claude-haiku-5-5"],
    });
    expect((await POST(request(premium()))).status).toBe(200);
    expect(m.consumePremiumVerdict).toHaveBeenCalledTimes(1);
    expect(m.refundPremiumVerdict).not.toHaveBeenCalled();
  });

  it("charges a Haiku-only panel when the operator configured only Haiku seats", async () => {
    vi.stubEnv("PREMIUM_JUDGE_MODELS", "claude-haiku-5-5,claude-haiku-5-5");
    m.judgePremiumPanel.mockResolvedValue({
      runs: [ok(RUN), ok(RUN)],
      models: ["claude-haiku-5-5", "claude-haiku-5-5"],
    });
    expect((await POST(request(premium()))).status).toBe(200);
    expect(m.consumePremiumVerdict).toHaveBeenCalledTimes(1);
    expect(m.refundPremiumVerdict).not.toHaveBeenCalled();
  });

  it("still answers 200 when consume fails (the stale sweep settles it)", async () => {
    m.consumePremiumVerdict.mockRejectedValue(new Error("SQLITE_BUSY"));
    const res = await POST(request(premium()));
    expect(res.status).toBe(200);
    expect(m.refundPremiumVerdict).not.toHaveBeenCalled();
  });
});

describe("premium verdict: escalation, trial and deadlines", () => {
  const LOW = [ok(vote("side_b")), ok(vote("side_b")), ok(vote("side_a"))];
  const factual = (v: JudgeVerdict) => vote(v, { dispute_type: "factual" });

  it("escalates a low-confidence panel with the fact-check context and records Haiku per extra run", async () => {
    m.judgePremiumPanel.mockResolvedValue({ runs: LOW, models: PANEL_MODELS });
    m.judgeExtra.mockResolvedValue([ok(vote("side_b")), FAILED]);
    const result: VerdictResult = (await (await POST(request(premium()))).json()).result;
    const [n, text, , lang, extra] = m.judgeExtra.mock.calls[0];
    expect(n).toBe(2);
    expect(text).toBe(ANON);
    expect(lang).toBe("en");
    expect(extra.premium).toBe(true);
    expect(extra.context).toMatch(/^FACT-CHECK/);
    expect(result.escalated).toBe(true);
    expect(result.runs).toHaveLength(4);
    expect(result.panel!.models).toEqual([...PANEL_MODELS, "claude-haiku-5-5"]);
  });

  it("runs the crux trial with the fact-check evidence appended", async () => {
    m.judgePremiumPanel.mockResolvedValue({
      runs: [ok(factual("side_b")), ok(factual("side_b")), ok(factual("side_b"))],
      models: PANEL_MODELS,
    });
    m.runCruxTrial.mockResolvedValue({ attack: "atk", outcome: "uncertain", reasoning: "r" });
    const result: VerdictResult = (await (await POST(request(premium()))).json()).result;
    expect(m.runCruxTrial.mock.calls[0][0]).toMatch(new RegExp(`^${ANON.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n\nFACT-CHECK`));
    expect(result.crux_trial?.outcome).toBe("uncertain");
    expect(result.confidence).toBe(3);
  });

  it("skips escalation once the escalation cutoff has passed, but still tries the trial", async () => {
    m.judgePremiumPanel.mockImplementation(async () => {
      clock += ESCALATION_CUTOFF_MS + 1;
      return { runs: [ok(factual("side_b")), ok(factual("side_b")), ok(factual("side_a"))], models: PANEL_MODELS };
    });
    // 2/3 with an opposite dissenter: confidence 2, normally escalated.
    const res = await POST(request(premium()));
    expect(res.status).toBe(200);
    expect(m.judgeExtra).not.toHaveBeenCalled();
  });

  it("skips both escalation and trial past the trial cutoff", async () => {
    m.judgePremiumPanel.mockImplementation(async () => {
      clock += TRIAL_CUTOFF_MS + 1;
      return { runs: [ok(factual("side_b")), ok(factual("side_b")), ok(factual("side_b"))], models: PANEL_MODELS };
    });
    const result: VerdictResult = (await (await POST(request(premium()))).json()).result;
    expect(m.judgeExtra).not.toHaveBeenCalled();
    expect(m.runCruxTrial).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("crux_trial");
  });

  it("tries the trial between the two cutoffs", async () => {
    m.judgePremiumPanel.mockImplementation(async () => {
      clock += ESCALATION_CUTOFF_MS + 1;
      return { runs: [ok(factual("side_b")), ok(factual("side_b")), ok(factual("side_b"))], models: PANEL_MODELS };
    });
    await POST(request(premium()));
    expect(m.runCruxTrial).toHaveBeenCalledTimes(1);
  });

  it("keeps panel.models aligned with runs when a seat failed", async () => {
    m.judgePremiumPanel.mockResolvedValue({
      runs: [ok(RUN), FAILED, ok(RUN)],
      models: ["claude-sonnet-5-5", "claude-haiku-5-5"],
    });
    const result: VerdictResult = (await (await POST(request(premium()))).json()).result;
    expect(result.runs).toHaveLength(2);
    expect(result.panel!.models).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
  });
});
