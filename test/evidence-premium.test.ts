/** Evidence in the one-sided premium flow, through POST /api/v1/verdict:
 * signed tokens in, one anonymization call over text and transcripts, the
 * EVIDENCE block to the judges (not to the fact-check), stored anonymized. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  claudeJson: vi.fn(),
  getViewer: vi.fn(),
  reservePremiumVerdict: vi.fn(),
  consumePremiumVerdict: vi.fn(),
  refundPremiumVerdict: vi.fn(),
  getEntitlement: vi.fn(),
  saveVerdict: vi.fn(),
  runFactCheck: vi.fn(),
  judgePremiumPanel: vi.fn(),
}));

vi.mock("@/lib/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/claude")>()),
  claudeJson: m.claudeJson,
}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getViewer: m.getViewer,
  isSameOrigin: () => true,
}));
vi.mock("@/lib/entitlements", () => ({
  reservePremiumVerdict: m.reservePremiumVerdict,
  consumePremiumVerdict: m.consumePremiumVerdict,
  refundPremiumVerdict: m.refundPremiumVerdict,
  getEntitlement: m.getEntitlement,
}));
vi.mock("@/lib/ratelimit", () => ({
  checkVerdictLimits: async () => ({ ok: true }),
  checkUserLimits: async () => ({ ok: true }),
  checkPremiumSiteCap: async () => ({ ok: true }),
}));
vi.mock("@/lib/db", () => ({ saveVerdict: m.saveVerdict, getVerdict: async () => null }));
vi.mock("@/lib/premium/factcheck", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/premium/factcheck")>()),
  runFactCheck: m.runFactCheck,
}));
vi.mock("@/lib/premium/panel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/premium/panel")>()),
  judgePremiumPanel: m.judgePremiumPanel,
}));

import { POST } from "../app/api/v1/verdict/route";
import { signEvidenceToken } from "../lib/evidence/token";
import type { JudgeRunOutput, VerdictApiResponse } from "../lib/types";

const ARGUMENT = "I paid the electricity bill in April and Deniz says it was my turn anyway.";
const RAW_CHAT = '[Chat screenshot · "Deniz"]\n21:02 ME: Did you pay the bill?\n21:05 Deniz: No, it was your turn';
const ANON_TEXT = "Party A paid the electricity bill in April and Party B says it was Party A's turn anyway.";
const ANON_CHAT = '[Chat screenshot · "Party B"]\n21:02 ME: Did you pay the bill?\n21:05 Party B: No, it was your turn';

const RUN: JudgeRunOutput = {
  verdict: "side_a",
  dispute_type: "factual",
  headline: "Party A paid",
  crux: "Who paid in April",
  split_points: null,
  conditional: null,
  argument_map: {
    side_a: [{ claim: "Paid in April", kind: "fact" }],
    side_b: [{ claim: "It was A's turn", kind: "fact" }],
    bedrock_a: "a",
    bedrock_b: "b",
  },
  facts_relied_on: [],
  losing_side_best_point: "Turns are unclear",
  leaning: "side_a",
  leaning_reason: "The chat",
};

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/v1/verdict", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

const token = (userId = "u1") =>
  signEvidenceToken({ audience: { type: "user", userId }, kind: "chat", transcript: RAW_CHAT, sha: "s1" })!.token;

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("PREMIUM_ENABLED", "");
  vi.stubEnv("EVIDENCE_ENABLED", "");
  vi.stubEnv("CRUX_TRIAL", "0");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.getViewer.mockResolvedValue({ user: { id: "u1" }, via: "bearer", sessionId: "s" });
  m.reservePremiumVerdict.mockResolvedValue({ ok: true, reservation: { id: "r1", fundedBy: "credits" } });
  m.getEntitlement.mockResolvedValue({ canUsePremium: true, blockedReason: null, credits: 1, subscription: null, resetsAt: null });
  m.runFactCheck.mockResolvedValue({ status: "none", claims: [] });
  m.judgePremiumPanel.mockResolvedValue({
    runs: [RUN, RUN, RUN].map((data) => ({ ok: true, data })),
    models: ["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  });
  m.claudeJson.mockResolvedValue({
    ok: true,
    data: {
      text: ANON_TEXT,
      evidence: [{ index: 0, transcript: ANON_CHAT }],
      replacements: [
        { original: "Deniz", replacement: "Party B" },
        { original: "I", replacement: "Party A" },
      ],
    },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("premium verdict with evidence", () => {
  it("judges the anonymized account with the EVIDENCE block and stores both, anonymized", async () => {
    const res = await POST(request({ argument: ARGUMENT, tier: "premium", evidence: [token()] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as VerdictApiResponse;
    expect(body.result.evidence_used).toEqual({ a: 1, b: 0 });
    expect(body.name_map).toEqual([
      { original: "I", replacement: "Party A" },
      { original: "Deniz", replacement: "Party B" },
    ]);

    // One anonymization call saw the account and the raw transcript.
    expect(m.claudeJson).toHaveBeenCalledTimes(1);
    expect(m.claudeJson.mock.calls[0][0].user).toContain(RAW_CHAT);

    // The fact-check sees the account only; the judges see the evidence.
    expect(m.runFactCheck).toHaveBeenCalledWith(ANON_TEXT, "en");
    const [text, , , context, , opts] = m.judgePremiumPanel.mock.calls[0];
    expect(text).toBe(ANON_TEXT);
    expect(context).toContain("EVIDENCE (machine transcripts of images the person asking attached;");
    expect(context).toContain('[E1 · Chat screenshot · "Party B"]');
    expect(context).toContain("21:02 Party A: Did you pay the bill?");
    expect(opts).toEqual({ evidence: true });

    // Nothing with a real name is stored.
    const saved = m.saveVerdict.mock.calls[0][0];
    expect(saved.input).toContain(ANON_TEXT);
    expect(saved.input).toContain("[E1 · Chat screenshot");
    expect(JSON.stringify(saved)).not.toContain("Deniz");
    expect(m.consumePremiumVerdict).toHaveBeenCalledTimes(1);
  });

  it("refuses a token minted for someone else before reserving a unit", async () => {
    const res = await POST(request({ argument: ARGUMENT, tier: "premium", evidence: [token("u2")] }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("evidence_invalid");
    expect(m.reservePremiumVerdict).not.toHaveBeenCalled();
  });

  it("refunds when the anonymizer cannot hide every name", async () => {
    m.claudeJson.mockResolvedValue({
      ok: true,
      data: {
        // A surname shared by two people cannot be substituted in code.
        text: "Party A paid and Yılmaz says no.",
        evidence: [{ index: 0, transcript: ANON_CHAT }],
        replacements: [
          { original: "Deniz Yılmaz", replacement: "Party B" },
          { original: "Ali Yılmaz", replacement: "Person C" },
        ],
      },
    });
    const res = await POST(request({ argument: ARGUMENT, tier: "premium", evidence: [token()] }));
    expect(res.status).toBe(503);
    expect(m.refundPremiumVerdict).toHaveBeenCalledWith("r1");
    expect(m.saveVerdict).not.toHaveBeenCalled();
    expect(m.judgePremiumPanel).not.toHaveBeenCalled();
  });

  it("leaves a premium request without evidence on the old path", async () => {
    m.claudeJson.mockResolvedValue({
      ok: true,
      data: { text: ANON_TEXT, replacements: [{ original: "Deniz", replacement: "Party B" }] },
    });
    const res = await POST(request({ argument: ARGUMENT, tier: "premium" }));
    expect(res.status).toBe(200);
    expect((await res.json()).result.evidence_used).toBeUndefined();
    expect(m.claudeJson.mock.calls[0][0].user).toBe(ARGUMENT);
    expect(m.judgePremiumPanel.mock.calls[0]).toHaveLength(4);
  });
});
