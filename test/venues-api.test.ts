import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The case and respondent endpoints end to end against a real (temporary)
 * database and the real entitlements, with the model calls, sessions,
 * Turnstile and the evidence package mocked. Background judging is captured
 * and run explicitly with drain().
 */

const m = vi.hoisted(() => ({
  getViewer: vi.fn(),
  isSameOrigin: vi.fn(),
  verifyTurnstile: vi.fn(),
  anonymizeSubmission: vi.fn(),
  verifyEvidenceTokens: vi.fn(),
  handleEvidenceUpload: vi.fn(),
  judgeAnonymized: vi.fn(),
  claudeJson: vi.fn(),
  scheduled: [] as (() => Promise<void>)[],
}));

vi.mock("@/lib/auth", () => ({
  getViewer: m.getViewer,
  isSameOrigin: m.isSameOrigin,
  authConfigured: () => true,
  // "x-test-dead" stands for a bearer token that matches no live session.
  resolveViewer: async (req: Request) =>
    req.headers.has("x-test-dead")
      ? { viewer: null, deadBearer: true }
      : { viewer: (await m.getViewer(req)) ?? null, deadBearer: false },
  hasDeadBearer: async (req: Request) => req.headers.has("x-test-dead"),
  premiumEnabled: (env: Record<string, string | undefined> = process.env) => env.PREMIUM_ENABLED?.trim() !== "0",
  derivedSecret: (purpose: string) => createHmac("sha256", "test-secret").update(purpose).digest(),
  getAuth: vi.fn(),
}));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: m.verifyTurnstile }));
vi.mock("@/lib/evidence", () => ({
  anonymizeSubmission: m.anonymizeSubmission,
  verifyEvidenceTokens: m.verifyEvidenceTokens,
  handleEvidenceUpload: m.handleEvidenceUpload,
  caseNameKeys: () => (name: string) => [`key:${name.toLowerCase()}`],
  evidenceBlock: (groups: { idPrefix: string; items: { transcript: string }[] }[]) =>
    groups.length
      ? `EVIDENCE:\n${groups.flatMap((g) => g.items.map((it, i) => `[${g.idPrefix}${i + 1}] ${it.transcript}`)).join("\n")}`
      : null,
}));
vi.mock("@/lib/premium/run", () => ({
  judgeAnonymized: m.judgeAnonymized,
  premiumLogLine: () => "[premium] test",
}));
vi.mock("@/lib/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/claude")>()),
  claudeJson: m.claudeJson,
}));
vi.mock("@/lib/cases/schedule", () => ({
  scheduleJudging: (fn: () => Promise<void>) => {
    m.scheduled.push(fn);
  },
}));

const dir = mkdtempSync(path.join(tmpdir(), "verdict-venues-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const http = await import("../lib/cases/http");
const { historyHandler } = await import("../lib/history/http");
const ent = await import("../lib/entitlements");
const { getDb } = await import("../lib/db");
const { getCase } = await import("../lib/cases/db");

import type { CaseView } from "../lib/case-types";
import type { HistoryResponse } from "../lib/history-types";
import type { VerdictResult } from "../lib/types";

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const ORIGIN = "http://localhost:3600";
const SIDE_A = "I paid the electricity bill in April and Deniz says I never did. I have the receipt somewhere.";
const SIDE_B = "I asked about the April bill because the account showed it unpaid; my partner insists it was paid.";

let n = 0;
const uid = (p = "user") => `${p}-${++n}-${Math.random().toString(36).slice(2, 7)}`;
const ip = () => `10.0.${Math.floor(++n / 250)}.${n % 250}`;

function result(overrides: Partial<VerdictResult> = {}): VerdictResult {
  return {
    verdict: "side_a",
    dispute_type: "factual",
    headline: "Party A paid",
    crux: "Whether the April bill was paid",
    split_points: null,
    conditional: null,
    argument_map: {
      side_a: [{ claim: "Paid in April", kind: "fact" }],
      side_b: [{ claim: "Account showed unpaid", kind: "fact" }],
      bedrock_a: "a",
      bedrock_b: "b",
    },
    facts_relied_on: [],
    losing_side_best_point: "The account showed it unpaid",
    confidence: 4,
    runs: ["side_a", "side_a", "side_b"],
    demo: false,
    tier: "premium",
    lang: "en",
    agreed_facts: ["There was an April bill"],
    disputed_facts: [
      { fact: "Was it paid?", party_a: "Yes", party_b: "No", finding: "unsettled", decisive: true },
      { fact: "Second", party_a: "x", party_b: "y", finding: "a", decisive: true },
    ],
    would_change: ["A bank record for April"],
    ...overrides,
  };
}

function okOutcome(r: VerdictResult = result(), extra: { refused?: boolean; degraded?: boolean } = {}) {
  return { status: "ok", result: r, input: "doc", refused: false, degraded: false, ...extra };
}

type Opts = { user?: string; via?: "cookie" | "bearer"; body?: unknown; headers?: Record<string, string>; ip?: string };

function req(method: string, url: string, opts: Opts = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json", ...opts.headers };
  if (opts.user) headers["x-test-user"] = opts.user;
  if (opts.via) headers["x-test-via"] = opts.via;
  headers["x-forwarded-for"] = opts.ip ?? "192.0.2.1";
  return new Request(`${ORIGIN}${url}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  });
}

async function body<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Runs every captured background judging run (and any they schedule). */
async function drain(): Promise<void> {
  while (m.scheduled.length) await m.scheduled.shift()!();
}

async function owner(creditCount = 2): Promise<string> {
  const id = uid("owner");
  if (creditCount > 0) await ent.grantCredits({ userId: id, credits: creditCount, source: "admin", externalId: `g:${id}` });
  return id;
}

async function create(ownerId: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await http.createCaseHandler(
    req("POST", "/api/v1/cases", { user: ownerId, body: { text: SIDE_A, lang: "en", ...extra }, headers }),
  );
  return { res, data: await body<{ case: CaseView; name_map: unknown[]; replayed?: boolean; code?: string }>(res) };
}

const tokenOf = (view: CaseView) => view.inviteUrl!.split("/r/")[1];

async function getOwner(ownerId: string, id: string) {
  return (await body<{ case: CaseView }>(await http.getCaseHandler(req("GET", `/api/v1/cases/${id}`, { user: ownerId }), id))).case;
}

async function getRespondent(token: string, user?: string, claim?: string) {
  const headers: Record<string, string> = claim ? { "respondent-claim": claim } : {};
  const res = await http.respondGetHandler(req("GET", `/api/v1/respond/${token}`, { user, headers }), token);
  return { res, view: res.ok ? (await body<{ case: CaseView }>(res)).case : null };
}

function respond(token: string, opts: Opts & { text?: string; evidence?: string[] } = {}) {
  return http.respondPostHandler(
    req("POST", `/api/v1/respond/${token}`, {
      ...opts,
      ip: opts.ip ?? ip(),
      body: { text: opts.text ?? SIDE_B, ...(opts.evidence ? { evidence: opts.evidence } : {}), turnstileToken: "t" },
    }),
    token,
  );
}

beforeEach(() => {
  m.scheduled.length = 0;
  vi.stubEnv("CASES_ENABLED", "");
  vi.stubEnv("EVIDENCE_ENABLED", "");
  vi.stubEnv("PREMIUM_ENABLED", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("BETTER_AUTH_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
  m.getViewer.mockImplementation(async (r: Request) => {
    const id = r.headers.get("x-test-user");
    if (!id) return null;
    return {
      user: { id, email: `${id}@verdict.local`, name: "T", image: null },
      sessionId: `s-${id}`,
      via: r.headers.get("x-test-via") ?? "bearer",
    };
  });
  m.isSameOrigin.mockImplementation((r: Request) => !r.headers.get("x-test-cross"));
  m.verifyTurnstile.mockResolvedValue("ok");
  m.anonymizeSubmission.mockImplementation(
    async (input: { narrator: string; text: string; evidence: { kind: string; transcript: string }[] }) => {
      const other = input.narrator === "Party A" ? "Party B" : "Party A";
      return {
        text: input.text.replace(/\bI\b/g, input.narrator).replace(/Deniz|my partner/g, other),
        evidence: input.evidence.map((e) => ({ kind: e.kind, transcript: e.transcript.replace(/ME/g, input.narrator) })),
        nameMap: [{ original: "I", replacement: input.narrator }, ...(input.text.includes("Deniz") ? [{ original: "Deniz", replacement: other }] : [])],
        people: input.text.includes("Deniz") ? [{ label: other, key: "key:deniz" }] : [],
      };
    },
  );
  m.verifyEvidenceTokens.mockImplementation(
    (tokens: string[], audience: { type: string; userId?: string; caseId?: string; party?: string }) => {
      const aud = audience.type === "user" ? `u:${audience.userId}` : `r:${audience.caseId}${audience.party ? `:${audience.party}` : ""}`;
      if (tokens.every((t) => t === `good:${aud}`)) {
        return { ok: true, items: tokens.map(() => ({ kind: "chat", transcript: "21:02 ME: did you pay?" })) };
      }
      return { ok: false, code: "evidence_invalid" };
    },
  );
  m.handleEvidenceUpload.mockImplementation(async () => Response.json({ items: [] }));
  m.judgeAnonymized.mockClear();
  m.judgeAnonymized.mockResolvedValue(okOutcome());
  m.claudeJson.mockResolvedValue({ ok: true, data: { summary: "The receipt settled the disputed payment." } });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});


const verdictIdOf = async (caseId: string) => {
  const db = await getDb();
  return String((await db.execute({ sql: "SELECT verdict_id FROM case_verdicts WHERE case_id = ?", args: [caseId] })).rows[0].verdict_id);
};

describe("the scene of a case", () => {
  it("is kept from creation, shown to both sides and given to the verdict and the history", async () => {
    const o = await owner();
    const { res, data } = await create(o, { venue: "farm" });
    expect(res.status).toBe(201);
    expect(data.case.venue).toBe("farm");
    expect((await getCase(data.case.id))?.venue).toBe("farm");
    expect((await getRespondent(tokenOf(data.case))).view?.venue).toBe("farm");

    expect((await respond(tokenOf(data.case))).status).toBe(202);
    await drain();
    const judged = await getOwner(o, data.case.id);
    expect(judged.status).toBe("judged");
    expect(judged.venue).toBe("farm");

    const { getVerdict } = await import("../lib/db");
    expect((await getVerdict(await verdictIdOf(data.case.id)))?.venue).toBe("farm");

    const list = await body<{ cases: { id: string; venue?: string | null }[] }>(
      await http.listCasesHandler(req("GET", "/api/v1/cases", { user: o })),
    );
    expect(list.cases.find((c) => c.id === data.case.id)?.venue).toBe("farm");
    const history = await body<HistoryResponse>(await historyHandler(req("GET", "/api/v1/me/history", { user: o })));
    expect(history.items.find((i) => i.id === data.case.id)?.venue).toBe("farm");
  });

  it("is empty for a missing or unknown name, and an old case keeps showing the court", async () => {
    const o = await owner(4);
    for (const venue of [undefined, "moon", 3, ["beach"]]) {
      const { res, data } = await create(o, venue === undefined ? {} : { venue });
      expect(res.status).toBe(201);
      expect(data.case.venue).toBeNull();
    }
  });

  it("stays with the case through a replayed create", async () => {
    const o = await owner();
    const headers = { "idempotency-key": "venue-replay-1" };
    const first = await create(o, { venue: "ice" }, headers);
    const again = await create(o, { venue: "tv" }, headers);
    expect(again.data.replayed).toBe(true);
    expect(again.data.case.id).toBe(first.data.case.id);
    expect(again.data.case.venue).toBe("ice");
  });
});
