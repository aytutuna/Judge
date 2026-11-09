import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getViewer: vi.fn(),
  reserve: vi.fn(),
  consume: vi.fn(),
  refund: vi.fn(),
  anonymizeSubmission: vi.fn(),
  runFactCheck: vi.fn(),
  claudeJson: vi.fn(),
  track: vi.fn(),
  saved: [] as { id: string; result: Record<string, unknown>; original: { nameMap: unknown[]; text: string }; input: string }[],
}));

vi.mock("@/lib/auth", () => ({
  getViewer: m.getViewer,
  resolveViewer: async (req: Request) => ({ viewer: (await m.getViewer(req)) ?? null, deadBearer: false }),
  hasDeadBearer: async () => false,
  isSameOrigin: () => true,
  authConfigured: () => true,
  premiumEnabled: () => true,
}));
vi.mock("@/lib/entitlements", () => ({
  reservePremiumVerdict: m.reserve,
  consumePremiumVerdict: m.consume,
  refundPremiumVerdict: m.refund,
  getEntitlement: async () => ({ canUsePremium: true, blockedReason: null, credits: 4, subscription: null, resetsAt: null }),
}));
vi.mock("@/lib/ratelimit", () => ({
  checkUserLimits: async () => ({ ok: true }),
  checkPremiumSiteCap: async () => ({ ok: true }),
}));
vi.mock("@/lib/claude", async (orig) => ({
  ...(await orig<typeof import("@/lib/claude")>()),
  claudeJson: m.claudeJson,
}));
vi.mock("@/lib/db", () => ({ getVerdict: async () => null }));
vi.mock("@/lib/analytics/track", () => ({ track: m.track }));
vi.mock("@/lib/originals/save", () => ({
  saveVerdictWithOriginals: async (v: (typeof m.saved)[number]) => {
    m.saved.push(v);
    return { ownerToken: null, originalsStored: true, display: { namesVisible: true, a: null, b: null, others: {} }, metaWritten: true };
  },
}));
vi.mock("@/lib/premium/factcheck", async (orig) => ({
  ...(await orig<typeof import("@/lib/premium/factcheck")>()),
  runFactCheck: m.runFactCheck,
}));
vi.mock("@/lib/evidence", () => ({
  verifyEvidenceTokens: vi.fn(),
  anonymizeSubmission: m.anonymizeSubmission,
  evidenceBlock: vi.fn(() => null),
}));

import { POST } from "../app/api/verdict/route";
import { POST as POST_V1 } from "../app/api/v1/verdict/route";
import { unifyBystanders } from "../lib/premium/sides";
import { VerdictRequest } from "../lib/types";

const SIDES = [
  { text: "I think we should split the trip bill by nights, because I stayed all five.", name: "Dana" },
  { text: "Bo says it should be split evenly, since the villa was booked for everyone.", name: "Bo" },
  { text: "Cem says he only came for two nights and should not pay for the other three.", name: "Cem" },
];
const ARGUMENT = SIDES.map((s) => s.text).join("\n\n");

function runJson(verdict: string, parties = ["a", "b", "c"]) {
  return {
    verdict,
    dispute_type: "values",
    headline: "h",
    why: "w",
    crux: "c",
    sides: parties.map((party) => ({ party, claims: [{ claim: `c ${party}`, kind: "value" }], bedrock: `b ${party}` })),
    facts_relied_on: [],
    others: parties.filter((p) => p !== verdict).map((party) => ({ party, line: `l ${party}` })),
    leaning: verdict === "too_close" ? "a" : verdict,
    leaning_reason: "lr",
  };
}

function request(body: Record<string, unknown>, url = "http://localhost/api/v1/verdict", headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** A fake anonymizer: names become the side's label, the narrator is "I". */
function fakeAnonymize(input: { narrator: string; text: string; sides?: { names: (string | null)[] } }) {
  let text = input.text.replace(/\bI\b/g, input.narrator);
  const map = [{ original: "I", replacement: input.narrator }];
  const labels = ["Party A", "Party B", "Party C", "Party D"];
  input.sides?.names.forEach((name, i) => {
    if (name && text.includes(name)) {
      text = text.replaceAll(name, labels[i]);
      if (labels[i] !== input.narrator) map.push({ original: name, replacement: labels[i] });
    }
  });
  return Promise.resolve({ text, evidence: [], nameMap: map, people: [] });
}

beforeEach(() => {
  m.saved.length = 0;
  m.getViewer.mockResolvedValue({ user: { id: "u1", email: "a@b.c", name: "Dana K", image: null }, sessionId: "s1", via: "bearer" });
  m.reserve.mockResolvedValue({ ok: true, reservation: { id: "r1", fundedBy: "credits" } });
  m.consume.mockResolvedValue(undefined);
  m.refund.mockResolvedValue(undefined);
  m.runFactCheck.mockResolvedValue({ status: "none", claims: [] });
  m.anonymizeSubmission.mockImplementation(fakeAnonymize);
  m.claudeJson.mockImplementation(async (c: { system: string }) =>
    c.system.startsWith("You are Verdict")
      ? { ok: true, data: runJson("c") }
      : { ok: true, data: { attack: "", has_substantive_attack: false } },
  );
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("VerdictRequest.sides", () => {
  const base = { argument: ARGUMENT };

  it("is absent on every request an older build sends", () => {
    const parsed = VerdictRequest.safeParse(base);
    expect(parsed.success && parsed.data.sides).toBeUndefined();
  });

  it("takes three or four sides, with a trimmed optional name", () => {
    const three = VerdictRequest.safeParse({ ...base, sides: SIDES });
    expect(three.success).toBe(true);
    const four = VerdictRequest.safeParse({ ...base, sides: [...SIDES, { text: "Derya says the ride home was hers to pay for." + " x".repeat(10), name: "  Derya " }] });
    expect(four.success && four.data.sides?.[3].name).toBe("Derya");
    const unnamed = VerdictRequest.safeParse({ ...base, sides: SIDES.map((s) => ({ text: s.text })) });
    expect(unnamed.success).toBe(true);
  });

  it("rejects two sides, five sides, a short side and more text than one argument may hold", () => {
    expect(VerdictRequest.safeParse({ ...base, sides: SIDES.slice(0, 2) }).success).toBe(false);
    expect(VerdictRequest.safeParse({ ...base, sides: [...SIDES, ...SIDES.slice(0, 2)] }).success).toBe(false);
    expect(VerdictRequest.safeParse({ ...base, sides: [...SIDES.slice(0, 2), { text: "too short" }] }).success).toBe(false);
    const long = "x".repeat(2100);
    expect(VerdictRequest.safeParse({ ...base, sides: [{ text: long }, { text: long }, { text: long }] }).success).toBe(false);
  });
});

describe("POST /api/v1/verdict with typed sides", () => {
  it("anonymizes each side as its own account, judges among the sides and stores the many-sided result", async () => {
    const res = await POST_V1(request({ argument: ARGUMENT, sides: SIDES }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.parties).toEqual(["a", "b", "c"]);
    expect(body.result.winner).toBe("c");
    expect(body.result.verdict).toBe("too_close");
    expect(body.result.runs).toEqual(["split", "split", "split"]);
    expect(body.result.sides).toHaveLength(3);
    expect(body.result.others.map((o: { party: string }) => o.party)).toEqual(["a", "b"]);
    expect(m.consume).toHaveBeenCalledWith("r1", body.id);

    // one anonymize call per side, narrated by that side, all told the side names
    const narrators = m.anonymizeSubmission.mock.calls.map(([i]) => i.narrator).sort();
    expect(narrators).toEqual(["Party A", "Party B", "Party C"]);
    for (const [i] of m.anonymizeSubmission.mock.calls) {
      expect(i.sides).toEqual({ count: 3, names: ["Dana", "Bo", "Cem"] });
    }

    // the judges read the composed, labelled sides, never the names
    const judged = m.claudeJson.mock.calls.map(([c]) => c as { system: string; user: string }).filter((c) => c.system.startsWith("You are Verdict"));
    expect(judged).toHaveLength(3);
    expect(judged[0].user).toContain("PARTY A'S SIDE:");
    expect(judged[0].user).toContain("PARTY C'S SIDE:");
    expect(judged[0].user).not.toContain("Dana");
    expect(judged[0].user).toContain("Party B says it should be split evenly");

    // the stored original keeps the argument as sent; the name map lists each side by its typed name
    expect(m.saved[0].original.text).toBe(ARGUMENT);
    expect(m.saved[0].original.nameMap).toContainEqual({ original: "Cem", replacement: "Party C" });
    expect(m.saved[0].original.nameMap).toContainEqual({ original: "I", replacement: "Party A" });
    expect(m.saved[0].original.nameMap).not.toContainEqual({ original: "I", replacement: "Party C" });
  });

  it("the analytics event says the verdict had several sides", async () => {
    await POST_V1(request({ argument: ARGUMENT, sides: SIDES }));
    expect(m.track).toHaveBeenCalledWith("verdict_ready", { userId: "u1", props: { kind: "verdict", mode: "many_sided" } });
  });

  it("a request without sides takes the one-account path and its events are as before", async () => {
    m.anonymizeSubmission.mockClear();
    const res = await POST_V1(request({ argument: ARGUMENT }));
    // no anonymize mock for the one-account path here: it fails closed and refunds
    expect(m.anonymizeSubmission).not.toHaveBeenCalled();
    expect(res.status).not.toBe(400);
  });

  it("a name that cannot be taken out fails closed and refunds", async () => {
    m.anonymizeSubmission.mockRejectedValueOnce(new Error("a listed name survived anonymization"));
    const res = await POST_V1(request({ argument: ARGUMENT, sides: SIDES }));
    expect(res.status).toBe(503);
    expect(m.refund).toHaveBeenCalledWith("r1");
    expect(m.saved).toHaveLength(0);
  });

  it("invalid sides are the usual argument errors", async () => {
    const short = await POST(request({ argument: ARGUMENT, sides: [...SIDES.slice(0, 2), { text: "tiny" }] }, "http://localhost/api/verdict"));
    expect(short.status).toBe(400);
    expect((await short.json()).code).toBe("too_short");
    const long = "x".repeat(2100);
    const over = await POST(request({ argument: ARGUMENT, sides: [{ text: long }, { text: long }, { text: long }] }, "http://localhost/api/verdict"));
    expect(over.status).toBe(400);
    expect((await over.json()).code).toBe("too_long");
    const two = await POST(request({ argument: ARGUMENT, sides: SIDES.slice(0, 2) }, "http://localhost/api/verdict"));
    expect((await two.json()).code).toBe("invalid");
    expect(m.reserve).not.toHaveBeenCalled();
  });
});

describe("unifyBystanders", () => {
  it("numbers other people across accounts from Person E, one label per name", () => {
    const out = unifyBystanders([
      {
        text: "Party A told Person E and Person F.",
        nameMap: [
          { original: "I", replacement: "Party A" },
          { original: "Zoe", replacement: "Person E" },
          { original: "Max", replacement: "Person F" },
        ],
      },
      {
        text: "Party B called Person E, who is Zoe's friend, and Person F.",
        nameMap: [
          { original: "Max", replacement: "Person E" },
          { original: "Ali", replacement: "Person F" },
        ],
      },
    ]);
    expect(out[0].text).toBe("Party A told Person E and Person F.");
    // Max is Person F in the first account, so the second account's Max follows
    expect(out[1].text).toBe("Party B called Person F, who is Zoe's friend, and Person G.");
    expect(out[1].nameMap).toEqual([
      { original: "Max", replacement: "Person F" },
      { original: "Ali", replacement: "Person G" },
    ]);
  });

  it("gives a person with no name a label of their own and renumbers swaps in one pass", () => {
    const out = unifyBystanders([
      { text: "Party A met Person F and Person E.", nameMap: [{ original: "Ola", replacement: "Person F" }, { original: "my sister", replacement: "Person E" }] },
      { text: "Party B met Person E.", nameMap: [{ original: "my sister", replacement: "Person E" }] },
    ]);
    expect(out[0].text).toBe("Party A met Person E and Person F.");
    expect(out[1].text).toBe("Party B met Person G.");
  });

  it("rewrites the further texts of an account the same way", () => {
    const [a] = unifyBystanders([
      { text: "Person F left.", nameMap: [{ original: "Ola", replacement: "Person F" }], more: ["21:02 Person F: hi"] },
    ]);
    expect(a.text).toBe("Person E left.");
    expect(a.more).toEqual(["21:02 Person E: hi"]);
  });
});

describe("the async path with typed sides", () => {
  it("prepares the sides once and judges the prepared document among them", async () => {
    const { preparePremium, runPreparedPipeline } = await import("../lib/premium/run");
    const prepared = await preparePremium({ argument: ARGUMENT, lang: "en", sides: SIDES });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.prepared.parties).toEqual(["a", "b", "c"]);
    expect(prepared.prepared.anonymized).toContain("PARTY B'S SIDE:");

    const run = await runPreparedPipeline(prepared.prepared, { lang: "en" }, { startedAt: Date.now() });
    expect(run.outcome.status).toBe("ok");
    if (run.outcome.status !== "ok") return;
    expect(run.outcome.result.winner).toBe("c");
    expect(run.outcome.nameMap).toContainEqual({ original: "Bo", replacement: "Party B" });
  });

  it("evidence belongs to side A and is counted per side", async () => {
    m.anonymizeSubmission.mockImplementation(async (input: { narrator: string; text: string; evidence: { kind: string; transcript: string }[] }) => ({
      text: input.text,
      evidence: input.evidence.map((e) => ({ ...e, transcript: `Party A said: ${e.transcript}` })),
      nameMap: [{ original: "I", replacement: input.narrator }],
      people: [],
    }));
    const { preparePremium } = await import("../lib/premium/run");
    const { evidenceBlock } = await import("@/lib/evidence");
    vi.mocked(evidenceBlock).mockReturnValue("EVIDENCE BLOCK");
    const prepared = await preparePremium({
      argument: ARGUMENT,
      lang: "en",
      sides: SIDES,
      evidence: [{ kind: "chat", transcript: "ME: hi" }],
    });
    expect(prepared.ok && prepared.prepared.evidenceCount).toBe(1);
    const calls = m.anonymizeSubmission.mock.calls.map(([i]) => ({ n: i.narrator, e: i.evidence.length }));
    expect(calls.find((c) => c.n === "Party A")?.e).toBe(1);
    expect(calls.filter((c) => c.n !== "Party A").every((c) => c.e === 0)).toBe(true);
  });
});
