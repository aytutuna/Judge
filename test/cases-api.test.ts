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

const dir = mkdtempSync(path.join(tmpdir(), "verdict-cases-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const http = await import("../lib/cases/http");
const ent = await import("../lib/entitlements");
const { getDb, saveTranslation } = await import("../lib/db");
const { sweepCases, deleteUserCases } = await import("../lib/cases");
const { inviteHash } = await import("../lib/cases/invite");
import type { CaseView } from "../lib/case-types";
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

async function credits(userId: string): Promise<number> {
  return (await ent.getEntitlement(userId)).credits;
}

async function usage(userId: string): Promise<string[]> {
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT status FROM premium_usage WHERE user_id = ? ORDER BY created_at", args: [userId] });
  return rs.rows.map((r) => String(r.status));
}

async function count(sql: string, args: string[]): Promise<number> {
  const db = await getDb();
  return Number((await db.execute({ sql, args })).rows[0].n);
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

function judgeNow(ownerId: string, id: string, b: unknown = { mode: "only_mine" }) {
  return http.judgeCaseHandler(req("POST", `/api/v1/cases/${id}/judge`, { user: ownerId, body: b }), id);
}

function ownerAppeal(ownerId: string, id: string, text = "The receipt shows the payment on April 3rd, which Party B ignored.", headers: Record<string, string> = {}) {
  return http.ownerAppealHandler(req("POST", `/api/v1/cases/${id}/appeals`, { user: ownerId, body: { text }, headers }), id);
}

async function setCase(id: string, sets: string, args: (string | null)[] = []) {
  const db = await getDb();
  await db.execute({ sql: `UPDATE cases SET ${sets} WHERE id = ?`, args: [...args, id] });
}

beforeEach(() => {
  m.scheduled.length = 0;
  vi.stubEnv("CASES_ENABLED", "");
  vi.stubEnv("EVIDENCE_ENABLED", "");
  vi.stubEnv("PREMIUM_ENABLED", "");
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
    (tokens: string[], audience: { type: string; userId?: string; caseId?: string }) => {
      const aud = audience.type === "user" ? `u:${audience.userId}` : `r:${audience.caseId}`;
      if (tokens.every((t) => t === `good:${aud}`)) {
        return { ok: true, items: tokens.map(() => ({ kind: "chat", transcript: "21:02 ME: did you pay?" })) };
      }
      return { ok: false, code: "evidence_invalid" };
    },
  );
  m.handleEvidenceUpload.mockImplementation(async () => Response.json({ items: [] }));
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

describe("POST /api/v1/cases", () => {
  it("creates a case: holds one unit, anonymizes side A, returns the invite and the name map", async () => {
    const o = await owner(2);
    const { res, data } = await create(o);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const c = data.case;
    expect(c.status).toBe("awaiting_respondent");
    expect(c.role).toBe("owner");
    expect(c.yourParty).toBe("a");
    expect(c.mode).toBeNull();
    expect(c.inviteUrl).toMatch(/^http:\/\/localhost:3600\/r\/[A-Za-z0-9_-]{22}$/);
    expect(c.sides).toHaveLength(1);
    expect(c.sides[0].text).toContain("Party A paid the electricity bill");
    expect(c.sides[0].text).not.toContain("Deniz");
    expect(c.canJudgeNow).toBe(true);
    expect(c.appeal).toEqual({ allowed: false, blockedBy: "not_judged" });
    expect(data.name_map).toEqual([
      { original: "I", replacement: "Party A" },
      { original: "Deniz", replacement: "Party B" },
    ]);
    expect(await credits(o)).toBe(1);
    expect(await usage(o)).toEqual(["reserved"]);
    // Only the hash of the token is stored; real names never are.
    const db = await getDb();
    const row = (await db.execute({ sql: "SELECT * FROM cases WHERE id = ?", args: [c.id] })).rows[0];
    expect(row.invite_hash).toBe(inviteHash(tokenOf(c)));
    expect(JSON.stringify(row)).not.toContain(tokenOf(c));
    const dump = JSON.stringify((await db.execute({ sql: "SELECT * FROM case_sides WHERE case_id = ?", args: [c.id] })).rows);
    expect(dump).not.toContain("Deniz");
    expect(await count("SELECT count(*) AS n FROM case_people WHERE case_id = ?", [c.id])).toBe(1);
    const hold = (await db.execute({ sql: "SELECT hold_until FROM premium_usage WHERE user_id = ?", args: [o] })).rows[0];
    expect(String(hold.hold_until)).toBe(c.expiresAt);
  });

  it("replays an Idempotency-Key without a second hold", async () => {
    const o = await owner(3);
    const first = await create(o, {}, { "idempotency-key": "case-1" });
    const again = await create(o, {}, { "idempotency-key": "case-1" });
    expect(again.res.status).toBe(200);
    expect(again.data.replayed).toBe(true);
    expect(again.data.name_map).toEqual([]);
    expect(again.data.case.id).toBe(first.data.case.id);
    expect(await credits(o)).toBe(2);
  });

  it("gates: signed out 401, cross-site cookie 403, no credits 402, kill switch 503", async () => {
    expect((await http.createCaseHandler(req("POST", "/api/v1/cases", { body: { text: SIDE_A } }))).status).toBe(401);
    const o = await owner(1);
    const cross = await http.createCaseHandler(
      req("POST", "/api/v1/cases", { user: o, via: "cookie", body: { text: SIDE_A }, headers: { "x-test-cross": "1" } }),
    );
    expect((await body(cross)).code).toBe("bad_origin");
    const broke = await create(await owner(0));
    expect(broke.res.status).toBe(402);
    expect(broke.data.code).toBe("premium_required");
    vi.stubEnv("CASES_ENABLED", "0");
    const off = await create(o);
    expect(off.res.status).toBe(503);
    expect(off.data.code).toBe("not_configured");
    expect(await credits(o)).toBe(1);
  });

  it("validates the body: too_short, too_long, too_many_files, evidence_invalid, bad JSON", async () => {
    const o = await owner(2);
    const code = async (b: unknown) => (await body(await http.createCaseHandler(req("POST", "/api/v1/cases", { user: o, body: b })))).code;
    expect(await code({ text: "short" })).toBe("too_short");
    expect(await code({ text: "x".repeat(6001) })).toBe("too_long");
    expect(await code({ text: SIDE_A, evidence: ["a", "b", "c", "d"] })).toBe("too_many_files");
    expect(await code({ text: SIDE_A, evidence: ["good:u:someone-else"] })).toBe("evidence_invalid");
    expect(await code("{nope")).toBe("invalid");
    expect(await credits(o)).toBe(2);
  });

  it("stores anonymized evidence transcripts with side A", async () => {
    const o = await owner(2);
    const { res, data } = await create(o, { evidence: [`good:u:${o}`] });
    expect(res.status).toBe(201);
    expect(data.case.sides[0].evidence).toEqual([
      { id: expect.any(String), kind: "chat", transcript: "21:02 Party A: did you pay?" },
    ]);
  });

  it("anonymization failure refunds the hold and answers 503", async () => {
    const o = await owner(2);
    m.anonymizeSubmission.mockRejectedValueOnce(new Error("leak check failed"));
    const { res, data } = await create(o);
    expect(res.status).toBe(503);
    expect(data.code).toBe("unavailable");
    expect(await credits(o)).toBe(2);
    expect(await usage(o)).toEqual(["refunded"]);
  });
});

describe("respondent: GET and POST /api/v1/respond/{token}", () => {
  it("shows the invite without any side before answering; bad tokens 404", async () => {
    const o = await owner();
    const { data } = await create(o);
    const token = tokenOf(data.case);
    const { res, view } = await getRespondent(token);
    expect(res.status).toBe(200);
    expect(view!.role).toBe("respondent");
    expect(view!.yourParty).toBe("b");
    expect(view!.sides).toEqual([]);
    expect(view!.verdicts).toEqual([]);
    expect(view!.inviteUrl).toBeNull();
    expect(view!.ownInvite).toBe(false);
    expect((await getRespondent(token, o)).view!.ownInvite).toBe(true);
    expect((await getRespondent("short")).res.status).toBe(404);
    expect((await getRespondent("A".repeat(22))).res.status).toBe(404);
  });

  it("the answer starts judging; nobody sees the other side until the verdict; both see it after", async () => {
    const o = await owner(2);
    const { data } = await create(o);
    const token = tokenOf(data.case);
    const res = await respond(token, { headers: { "idempotency-key": "ans-1" } });
    expect(res.status).toBe(202);
    const answered = await body<{ case: CaseView; name_map: unknown[]; respondent_claim?: string }>(res);
    expect(answered.respondent_claim).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(answered.case.status).toBe("judging");
    expect(answered.case.pollAfterMs).toBe(3000);
    expect(answered.case.sides).toEqual([]);
    expect(answered.name_map).toEqual([{ original: "I", replacement: "Party B" }]);

    // While judging: the owner sees only side A, the respondent nothing.
    const ownerJudging = await getOwner(o, data.case.id);
    expect(ownerJudging.sides.map((s) => s.party)).toEqual(["a"]);
    expect(ownerJudging.respondentAnswered).toBe(true);
    expect(ownerJudging.inviteUrl).toBeNull();
    expect((await getRespondent(token)).view!.sides).toEqual([]);

    await drain();
    const call = m.judgeAnonymized.mock.calls.at(-1)![0];
    expect(call.twoSided).toBe(true);
    expect(call.text).toMatch(/^PARTY A'S ACCOUNT \(written by Party A, without seeing Party B's\):\n/);
    expect(call.text).toContain("PARTY B'S ACCOUNT (written by Party B, without seeing Party A's):");
    expect(call.text).not.toMatch(/Deniz|my partner/);

    const ownerView = await getOwner(o, data.case.id);
    expect(ownerView.status).toBe("judged");
    expect(ownerView.mode).toBe("two_sided");
    expect(ownerView.sides.map((s) => s.party)).toEqual(["a", "b"]);
    expect(ownerView.verdicts).toHaveLength(1);
    const r = ownerView.verdicts[0].result;
    expect(r.two_sided).toBe(true);
    expect(r.evidence_used).toEqual({ a: 0, b: 0 });
    expect(r.disputed_facts!.filter((d) => d.decisive)).toHaveLength(1);
    expect(ownerView.appeal).toEqual({ allowed: true, blockedBy: null });
    const respView = (await getRespondent(token)).view!;
    expect(respView.verdicts.map((v) => v.id)).toEqual([ownerView.verdicts[0].id]);
    expect(respView.sides.map((s) => s.party)).toEqual(["a", "b"]);
    // Holding the link is not enough to act as Party B; the claim is.
    expect(respView.appeal.blockedBy).toBe("not_party");
    expect((await getRespondent(token, undefined, answered.respondent_claim)).view!.appeal.blockedBy).toBe("signin_required");

    expect(await credits(o)).toBe(1);
    expect(await usage(o)).toEqual(["consumed"]);

    // A second answer is closed; the same Idempotency-Key replays.
    expect((await body(await respond(token))).code).toBe("case_closed");
    const replay = await respond(token, { headers: { "idempotency-key": "ans-1" } });
    expect(replay.status).toBe(202);
    const replayed = await body<{ replayed?: boolean; respondent_claim?: string }>(replay);
    expect(replayed.replayed).toBe(true);
    // A lost response can be retried: the same claim comes back.
    expect(replayed.respondent_claim).toBe(answered.respondent_claim);
    // Only the claim's derivation nonce is stored, never the claim.
    const db = await getDb();
    const stored = (await db.execute({ sql: "SELECT * FROM cases WHERE id = ?", args: [data.case.id] })).rows[0];
    expect(Object.values(stored)).not.toContain(answered.respondent_claim);
    expect(stored.respondent_user_id).toBeNull();
  });

  it("own_case for the owner, captcha_failed on a bad Turnstile token (bearer sessions skip it)", async () => {
    const o = await owner();
    const { data } = await create(o);
    const token = tokenOf(data.case);
    expect((await body(await respond(token, { user: o }))).code).toBe("own_case");
    m.verifyTurnstile.mockResolvedValue("invalid");
    const bad = await respond(token);
    expect(bad.status).toBe(403);
    expect((await body(bad)).code).toBe("captcha_failed");
    const resp = uid("resp");
    const bearer = await respond(token, { user: resp, via: "bearer" });
    expect(bearer.status).toBe(202);
    // A signed-in answer binds side B to that account; no claim is needed.
    expect((await body(bearer)).respondent_claim).toBeUndefined();
    const db = await getDb();
    expect((await db.execute({ sql: "SELECT respondent_user_id FROM cases WHERE id = ?", args: [data.case.id] })).rows[0].respondent_user_id).toBe(resp);
  });

  it("an expired invite is 410 and refunds the held unit", async () => {
    const o = await owner(2);
    const { data } = await create(o);
    await setCase(data.case.id, "expires_at = ?", [new Date(Date.now() - 1000).toISOString()]);
    const res = await respond(tokenOf(data.case));
    expect(res.status).toBe(410);
    expect((await body(res)).code).toBe("case_expired");
    expect(await credits(o)).toBe(2);
    const view = await getOwner(o, data.case.id);
    expect(view.status).toBe("expired");
    expect(view.canJudgeNow).toBe(true);
  });

  it("respondent evidence uploads go through the token gate with the respondent audience", async () => {
    const o = await owner();
    const { data } = await create(o);
    const token = tokenOf(data.case);
    const up = await http.respondEvidenceHandler(req("POST", `/api/v1/respond/${token}/evidence`, { body: { images: [] } }), token);
    expect(up.status).toBe(200);
    expect(m.handleEvidenceUpload.mock.calls[0][1]).toEqual({ type: "respondent", caseId: data.case.id });
    expect((await http.respondEvidenceHandler(req("POST", "/api/v1/respond/x/evidence"), "x")).status).toBe(404);
    // Respondent tokens are accepted on the answer.
    const res = await respond(token, { evidence: [`good:r:${data.case.id}`] });
    expect(res.status).toBe(202);
    await drain();
    const view = await getOwner(o, data.case.id);
    expect(view.sides.find((s) => s.party === "b")!.evidence[0].transcript).toBe("21:02 Party B: did you pay?");
    expect(view.verdicts[0].result.evidence_used).toEqual({ a: 0, b: 1 });
    const closed = await http.respondEvidenceHandler(req("POST", `/api/v1/respond/${token}/evidence`), token);
    expect((await body(closed)).code).toBe("case_closed");
  });
});

describe("judge now, retries and races", () => {
  it("awaiting needs mode only_mine; then a one-sided verdict on the held unit and the invite closes", async () => {
    const o = await owner(2);
    const { data } = await create(o);
    const token = tokenOf(data.case);
    expect((await body(await judgeNow(o, data.case.id, {}))).code).toBe("invalid");
    const res = await judgeNow(o, data.case.id);
    expect(res.status).toBe(202);
    expect((await body<{ case: CaseView }>(res)).case.status).toBe("judging");
    await drain();
    expect(m.judgeAnonymized.mock.calls.at(-1)![0].twoSided).toBeUndefined();
    const view = await getOwner(o, data.case.id);
    expect(view.status).toBe("judged");
    expect(view.mode).toBe("one_sided");
    expect(view.verdicts[0].result.two_sided).toBeUndefined();
    expect(view.verdicts[0].result.agreed_facts).toBeUndefined();
    expect(await usage(o)).toEqual(["consumed"]);
    expect(await credits(o)).toBe(1);
    // The respondent sees a case settled without them: no verdict, no text.
    const resp = (await getRespondent(token)).view!;
    expect(resp.mode).toBe("one_sided");
    expect(resp.verdicts).toEqual([]);
    expect(resp.sides).toEqual([]);
    expect((await body(await respond(token))).code).toBe("case_closed");
    // Judging again is a no-op.
    expect((await judgeNow(o, data.case.id)).status).toBe(200);
  });

  it("respondent vs judge-now at the same time: exactly one wins and one unit is consumed", async () => {
    const o = await owner(2);
    const { data } = await create(o);
    const [a, b] = await Promise.all([respond(tokenOf(data.case)), judgeNow(o, data.case.id)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toContain(202);
    await drain();
    const view = await getOwner(o, data.case.id);
    expect(view.status).toBe("judged");
    expect(view.verdicts).toHaveLength(1);
    expect(await usage(o)).toEqual(["consumed"]);
    expect(await credits(o)).toBe(1);
  });

  it("a failed run refunds; a retry reserves a new unit and keeps the mode", async () => {
    const o = await owner(2);
    const { data } = await create(o);
    await respond(tokenOf(data.case));
    m.judgeAnonymized.mockResolvedValueOnce({ status: "failed", code: "quota", error: "Claude HTTP 429" });
    await drain();
    const failed = await getOwner(o, data.case.id);
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toBe("quota");
    expect(failed.canJudgeNow).toBe(true);
    expect(await credits(o)).toBe(2);
    const retry = await judgeNow(o, data.case.id, {});
    expect(retry.status).toBe(202);
    await drain();
    const view = await getOwner(o, data.case.id);
    expect(view.status).toBe("judged");
    expect(view.mode).toBe("two_sided");
    expect(await usage(o)).toEqual(["refunded", "consumed"]);
    expect(await credits(o)).toBe(1);
  });

  it("a refused or degraded panel shows the verdict but refunds", async () => {
    const o = await owner(2);
    const { data } = await create(o);
    await respond(tokenOf(data.case));
    m.judgeAnonymized.mockResolvedValueOnce(okOutcome(result(), { degraded: true }));
    await drain();
    expect((await getOwner(o, data.case.id)).status).toBe("judged");
    expect(await usage(o)).toEqual(["refunded"]);
    expect(await credits(o)).toBe(2);
  });

  it("expired: judge-now reserves a new unit for a one-sided verdict (the held one came back)", async () => {
    const o = await owner(2);
    const { data } = await create(o);
    await setCase(data.case.id, "expires_at = ?", [new Date(Date.now() - 1000).toISOString()]);
    expect((await getOwner(o, data.case.id)).status).toBe("expired");
    const res = await judgeNow(o, data.case.id, {});
    expect(res.status).toBe(202);
    await drain();
    const view = await getOwner(o, data.case.id);
    expect(view.mode).toBe("one_sided");
    expect(view.status).toBe("judged");
    expect(await usage(o)).toEqual(["refunded", "consumed"]);
    expect(await credits(o)).toBe(1);
  });

  it("the sweep expires unanswered cases and fails stale runs, refunding each once", async () => {
    const o = await owner(3);
    const expiring = (await create(o)).data.case;
    await setCase(expiring.id, "expires_at = ?", [new Date(Date.now() - 1000).toISOString()]);
    const stuck = (await create(o)).data.case;
    await respond(tokenOf(stuck));
    m.scheduled.length = 0; // the run "crashed"
    await setCase(stuck.id, "judging_started_at = ?", [new Date(Date.now() - 11 * 60_000).toISOString()]);
    const swept = await sweepCases();
    expect(swept.expired).toBeGreaterThanOrEqual(1);
    expect(swept.failed).toBeGreaterThanOrEqual(1);
    expect((await getOwner(o, expiring.id)).status).toBe("expired");
    const failed = await getOwner(o, stuck.id);
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toBe("unavailable");
    expect(await credits(o)).toBe(3);
    await sweepCases();
    expect(await credits(o)).toBe(3);
  });

  it("expiry by the clock alone: open on day 6, expired after 7 days, refunded exactly once", async () => {
    const o = await owner(2);
    const created = (await create(o)).data.case;
    const token = tokenOf(created);
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    try {
      vi.setSystemTime(start + 6 * 24 * 60 * 60_000);
      expect((await getOwner(o, created.id)).status).toBe("awaiting_respondent");
      expect((await getRespondent(token)).view!.status).toBe("awaiting_respondent");
      await sweepCases();
      await ent.sweepStaleReservations();
      expect(await usage(o)).toEqual(["reserved"]);
      expect(await credits(o)).toBe(1);

      vi.setSystemTime(start + 7 * 24 * 60 * 60_000 + 60_000);
      // Reads report it before anything is written.
      const owned = await getOwner(o, created.id);
      expect(owned.status).toBe("expired");
      expect(owned.inviteUrl).toBeNull();
      expect(owned.canJudgeNow).toBe(true);
      expect((await getRespondent(token)).view!.status).toBe("expired");
      const late = await respond(token);
      expect(late.status).toBe(410);
      expect((await body(late)).code).toBe("case_expired");
      await sweepCases();
      vi.setSystemTime(start + 8 * 24 * 60 * 60_000);
      await sweepCases();
      await ent.sweepStaleReservations();
      expect(await usage(o)).toEqual(["refunded"]);
      expect(await credits(o)).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("another user's case is 404 everywhere", async () => {
    const o = await owner();
    const { data } = await create(o);
    const other = await owner();
    const id = data.case.id;
    expect((await http.getCaseHandler(req("GET", `/api/v1/cases/${id}`, { user: other }), id)).status).toBe(404);
    expect((await judgeNow(other, id)).status).toBe(404);
    expect((await http.deleteCaseHandler(req("DELETE", `/api/v1/cases/${id}`, { user: other }), id)).status).toBe(404);
    expect((await http.rotateInviteHandler(req("POST", `/api/v1/cases/${id}/invite`, { user: other }), id)).status).toBe(404);
    expect((await ownerAppeal(other, id)).status).toBe(404);
    expect((await http.getCaseHandler(req("GET", "/api/v1/cases/bad", { user: o }), "bad")).status).toBe(404);
  });
});

describe("invite and delete", () => {
  it("a new link turns the old one off; a closed case cannot rotate", async () => {
    const o = await owner();
    const { data } = await create(o);
    const old = tokenOf(data.case);
    const res = await http.rotateInviteHandler(req("POST", `/api/v1/cases/${data.case.id}/invite`, { user: o }), data.case.id);
    const { inviteUrl } = await body<{ inviteUrl: string }>(res);
    const fresh = inviteUrl.split("/r/")[1];
    expect(fresh).not.toBe(old);
    expect((await getRespondent(old)).res.status).toBe(404);
    expect((await getRespondent(fresh)).res.status).toBe(200);
    expect((await getOwner(o, data.case.id)).inviteUrl).toBe(inviteUrl);
    await judgeNow(o, data.case.id);
    const closed = await http.rotateInviteHandler(req("POST", `/api/v1/cases/${data.case.id}/invite`, { user: o }), data.case.id);
    expect(closed.status).toBe(409);
    expect((await body(closed)).code).toBe("case_closed");
  });

  it("deleting an awaiting case refunds the hold and removes every row; judging is 409", async () => {
    const o = await owner(2);
    const { data } = await create(o, { evidence: [`good:u:${o}`] });
    const del = (id: string) => http.deleteCaseHandler(req("DELETE", `/api/v1/cases/${id}`, { user: o }), id);
    const res = await del(data.case.id);
    expect(await body(res)).toEqual({ deleted: true });
    expect(await credits(o)).toBe(2);
    for (const t of ["cases WHERE id", "case_sides WHERE case_id", "case_evidence WHERE case_id", "case_people WHERE case_id"]) {
      expect(await count(`SELECT count(*) AS n FROM ${t} = ?`, [data.case.id])).toBe(0);
    }
    const busy = (await create(o)).data.case;
    await respond(tokenOf(busy));
    const refused = await del(busy.id);
    expect(refused.status).toBe(409);
    expect((await body(refused)).code).toBe("in_progress");
  });
});

describe("appeals", () => {
  async function judgedCase(ownerCredits = 3, respondAs?: string) {
    const o = await owner(ownerCredits);
    const { data } = await create(o);
    const token = tokenOf(data.case);
    const answered = await body<{ respondent_claim?: string }>(
      await respond(token, respondAs ? { user: respondAs, via: "bearer" } : {}),
    );
    await drain();
    return { o, id: data.case.id, token, claim: answered.respondent_claim };
  }

  const TEXT_B = "Party A's receipt is from March, not April.";
  function respondentAppeal(token: string, user: string | undefined, claim?: string) {
    return http.respondAppealHandler(
      req("POST", `/api/v1/respond/${token}/appeals`, { user, body: { text: TEXT_B, ...(claim ? { claim } : {}) } }),
      token,
    );
  }

  it("the owner adds context: 1 unit, re-judged with the whole record, labelled and summarized", async () => {
    const { o, id } = await judgedCase();
    m.judgeAnonymized.mockResolvedValueOnce(okOutcome(result({ verdict: "side_b", confidence: 3 })));
    const res = await ownerAppeal(o, id);
    expect(res.status).toBe(202);
    const accepted = await body<{ case: CaseView; name_map: unknown[] }>(res);
    expect(accepted.case.pollAfterMs).toBe(3000);
    expect(accepted.case.appeals[0]).toMatchObject({ party: "a", status: "judging" });
    expect(accepted.case.appeal.blockedBy).toBe("busy");
    await drain();
    const call = m.judgeAnonymized.mock.calls.at(-1)![0];
    expect(call.appeal).toMatch(/^An earlier verdict exists/);
    expect(call.text).toContain("NEW CONTEXT FROM PARTY A (added after an earlier verdict; Party A had seen that verdict and Party B's account; Party B has not answered it):");
    const view = await getOwner(o, id);
    expect(view.verdicts).toHaveLength(2);
    const latest = view.verdicts[1];
    expect(latest.appealId).toBe(view.appeals[0].id);
    expect(latest.result.appeal).toEqual({
      by: "a",
      outcome: "overturned",
      previous_id: view.verdicts[0].id,
      previous_verdict: "side_a",
      previous_confidence: 4,
      confidence_change: -1,
      summary: "The receipt settled the disputed payment.",
    });
    expect(view.appeals[0]).toMatchObject({ status: "judged", outcome: "overturned", verdictId: latest.id });
    expect(view.appeal.blockedBy).toBe("appeal_used");
    expect(await usage(o)).toEqual(["consumed", "consumed"]);
    const again = await ownerAppeal(o, id);
    expect(again.status).toBe(409);
    expect((await body(again)).code).toBe("appeal_used");
  });

  it("is closed before a verdict and while another appeal is judging", async () => {
    const o = await owner(3);
    const { data } = await create(o);
    expect((await body(await ownerAppeal(o, data.case.id))).code).toBe("case_closed");
    const { o: o2, id, token, claim } = await judgedCase();
    await ownerAppeal(o2, id);
    const r = await owner(2);
    const busy = await respondentAppeal(token, r, claim);
    expect((await body(busy)).code).toBe("in_progress");
    expect(await credits(r)).toBe(2);
  });

  it("an unrelated Premium account holding the link is not Party B, even before anyone is bound", async () => {
    const { id, token, o, claim } = await judgedCase();
    const stranger = await owner(2);
    expect((await getRespondent(token, stranger)).view!.appeal.blockedBy).toBe("not_party");
    const res = await respondentAppeal(token, stranger);
    expect(res.status).toBe(403);
    expect((await body(res)).code).toBe("not_party");
    // A made-up claim does not help, and the owner's second account is just as much a stranger.
    expect((await body(await respondentAppeal(token, stranger, "A".repeat(22)))).code).toBe("not_party");
    expect((await body(await respondentAppeal(token, o, claim))).code).toBe("not_party");
    expect(await credits(stranger)).toBe(2);
    const db = await getDb();
    expect((await db.execute({ sql: "SELECT respondent_user_id FROM cases WHERE id = ?", args: [id] })).rows[0].respondent_user_id).toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM case_appeals WHERE case_id = ?", [id])).toBe(0);
  });

  it("a respondent who answered signed in appeals with that account only, no claim needed", async () => {
    const r = await owner(1);
    const { id, token } = await judgedCase(3, r);
    const other = await owner(1);
    expect((await getRespondent(token, other)).view!.appeal.blockedBy).toBe("not_party");
    expect((await body(await respondentAppeal(token, other))).code).toBe("not_party");
    expect((await getRespondent(token, r)).view!.appeal).toEqual({ allowed: true, blockedBy: null });
    expect((await respondentAppeal(token, r)).status).toBe(202);
    await drain();
    const db = await getDb();
    expect((await db.execute({ sql: "SELECT respondent_user_id FROM cases WHERE id = ?", args: [id] })).rows[0].respondent_user_id).toBe(r);
    expect(await usage(r)).toEqual(["consumed"]);
  });

  it("a signed-out respondent signs in later and appeals once as Party B with the claim, binding the case", async () => {
    const { id, token, o, claim } = await judgedCase();
    const appeal = (user: string | undefined) => respondentAppeal(token, user, claim);
    expect((await appeal(undefined)).status).toBe(401);
    expect((await body(await appeal(o))).code).toBe("not_party");
    const r = await owner(1);
    expect((await getRespondent(token, r, claim)).view!.appeal).toEqual({ allowed: true, blockedBy: null });
    const res = await appeal(r);
    expect(res.status).toBe(202);
    const accepted = await body<{ case: CaseView; name_map: unknown[] }>(res);
    expect(accepted.case.role).toBe("respondent");
    expect(accepted.name_map).toEqual([{ original: "I", replacement: "Party B" }]);
    await drain();
    expect(m.judgeAnonymized.mock.calls.at(-1)![0].text).toContain("NEW CONTEXT FROM PARTY B");
    const db = await getDb();
    expect((await db.execute({ sql: "SELECT respondent_user_id FROM cases WHERE id = ?", args: [id] })).rows[0].respondent_user_id).toBe(r);
    expect(await usage(r)).toEqual(["consumed"]);
    // Once bound, the claim no longer lets anyone else in.
    const stranger = await owner(1);
    expect((await body(await appeal(stranger))).code).toBe("not_party");
    expect((await body(await appeal(r))).code).toBe("appeal_used");
    expect((await getRespondent(token, r)).view!.appeal.blockedBy).toBe("appeal_used");
    expect((await getRespondent(token, stranger, claim)).view!.appeal.blockedBy).toBe("not_party");
  });

  it("a respondent without Premium sees the upsell reason and gets 402 when trying", async () => {
    const { token, claim } = await judgedCase();
    const r = uid("free");
    expect((await getRespondent(token, r, claim)).view!.appeal.blockedBy).toBe("premium_required");
    const res = await respondentAppeal(token, r, claim);
    expect(res.status).toBe(402);
  });

  it("a failed or refused re-judge refunds and the same party may try again", async () => {
    const { o, id } = await judgedCase();
    m.judgeAnonymized.mockResolvedValueOnce(okOutcome(result(), { refused: true }));
    await ownerAppeal(o, id);
    await drain();
    let view = await getOwner(o, id);
    expect(view.appeals[0]).toMatchObject({ status: "failed", error: "refused" });
    expect(view.verdicts).toHaveLength(1);
    expect(view.appeal.allowed).toBe(true);
    expect(await usage(o)).toEqual(["consumed", "refunded"]);
    const appealId = view.appeals[0].id;
    m.judgeAnonymized.mockResolvedValueOnce(okOutcome(result({ confidence: 5 })));
    expect((await ownerAppeal(o, id)).status).toBe(202);
    await drain();
    view = await getOwner(o, id);
    expect(view.appeals).toHaveLength(1);
    expect(view.appeals[0]).toMatchObject({ id: appealId, status: "judged", outcome: "upheld" });
    expect(view.verdicts[1].result.appeal!.confidence_change).toBe(1);
  });

  it("an appeal answers the latest verdict even if another appeal was judged while it was being anonymized", async () => {
    const r = await owner(2);
    const { o, id, token } = await judgedCase(3, r);
    const base = m.anonymizeSubmission.getMockImplementation()!;
    m.anonymizeSubmission.mockImplementationOnce(async (input: Parameters<typeof base>[0]) => {
      // While Party A's context is being anonymized, Party B's appeal goes in and is judged.
      expect((await respondentAppeal(token, r)).status).toBe(202);
      await drain();
      return base(input);
    });
    // Judged in this order: Party B's appeal, then Party A's.
    m.judgeAnonymized
      .mockResolvedValueOnce(okOutcome(result({ verdict: "side_b", confidence: 3 })))
      .mockResolvedValueOnce(okOutcome(result({ verdict: "side_b", confidence: 2 })));
    expect((await ownerAppeal(o, id)).status).toBe(202);
    await drain();
    const view = await getOwner(o, id);
    expect(view.verdicts).toHaveLength(3);
    const last = view.verdicts[2].result.appeal!;
    // Compared with verdict 2 (Party B's appeal), not the original verdict 1.
    expect(last.previous_id).toBe(view.verdicts[1].id);
    expect(last).toMatchObject({ by: "a", outcome: "upheld", previous_verdict: "side_b", previous_confidence: 3, confidence_change: -1 });
  });

  it("a case judged on the owner's side alone gets the one-sided appeal note", async () => {
    const o = await owner(3);
    const { data } = await create(o);
    await judgeNow(o, data.case.id);
    await drain();
    expect((await ownerAppeal(o, data.case.id)).status).toBe(202);
    await drain();
    const call = m.judgeAnonymized.mock.calls.at(-1)![0];
    expect(call.twoSided).toBeUndefined();
    expect(call.appeal).toMatch(/^An earlier verdict exists and Party A, the only party who wrote an account/);
    expect(call.appeal).not.toContain("carry less weight than claims both accounts address");
  });

  it("logs every model step of a case with its id: each anonymize call, judging and the appeal summary", async () => {
    const { o, id } = await judgedCase();
    await ownerAppeal(o, id);
    await drain();
    const lines = vi.mocked(console.info).mock.calls.map((c) => String(c[0]));
    for (const step of ["anonymize_a", "anonymize_b", "anonymize_appeal_a", "appeal_summary"]) {
      expect(lines.some((l) => l.startsWith(`[cases] usage case=${id} step=${step} outcome=ok`))).toBe(true);
    }
    expect(lines.filter((l) => l.startsWith("[premium] test") && l.endsWith(`case=${id}`))).toHaveLength(2);
  });

  it("an appeal Idempotency-Key replays without a second charge", async () => {
    const { o, id } = await judgedCase();
    await ownerAppeal(o, id, undefined, { "idempotency-key": "ap-1" });
    await drain();
    const again = await ownerAppeal(o, id, undefined, { "idempotency-key": "ap-1" });
    expect(again.status).toBe(202);
    expect((await body(again)).replayed).toBe(true);
    expect(await usage(o)).toEqual(["consumed", "consumed"]);
  });
});

describe("list and account deletion", () => {
  it("lists the owner's cases newest first with a cursor", async () => {
    const o = await owner(5);
    for (let i = 0; i < 3; i++) await create(o);
    const page = async (q: string) =>
      body<{ cases: { id: string; status: string }[]; next: string | null }>(
        await http.listCasesHandler(req("GET", `/api/v1/cases${q}`, { user: o })),
      );
    const first = await page("?limit=2");
    expect(first.cases).toHaveLength(2);
    expect(first.next).not.toBeNull();
    const second = await page(`?limit=2&before=${encodeURIComponent(first.next!)}`);
    expect(second.cases.length).toBeGreaterThanOrEqual(1);
    expect(second.cases.map((c) => c.id)).not.toContain(first.cases[0].id);
    expect((await http.listCasesHandler(req("GET", "/api/v1/cases?limit=99", { user: o }))).status).toBe(400);
    expect((await http.listCasesHandler(req("GET", "/api/v1/cases"))).status).toBe(401);
  });

  it("deleteUserCases removes the owner's cases, verdicts and translations, and unbinds them elsewhere", async () => {
    const o = await owner(3);
    const { data } = await create(o, { evidence: [`good:u:${o}`] });
    await respond(tokenOf(data.case));
    await drain();
    const verdictId = (await getOwner(o, data.case.id)).verdicts[0].id;
    await saveTranslation(verdictId, "tr", result({ lang: "tr" }));
    // The same user is the bound respondent on someone else's case.
    const other = await owner(2);
    const theirs = (await create(other)).data.case;
    await respond(tokenOf(theirs));
    await drain();
    await setCase(theirs.id, "respondent_user_id = ?", [o]);

    await deleteUserCases(o);
    for (const t of [
      "cases WHERE id",
      "case_sides WHERE case_id",
      "case_evidence WHERE case_id",
      "case_people WHERE case_id",
      "case_verdicts WHERE case_id",
      "case_appeals WHERE case_id",
    ]) {
      expect(await count(`SELECT count(*) AS n FROM ${t} = ?`, [data.case.id])).toBe(0);
    }
    expect(await count("SELECT count(*) AS n FROM verdicts WHERE id = ?", [verdictId])).toBe(0);
    expect(await count("SELECT count(*) AS n FROM verdict_translations WHERE id = ?", [verdictId])).toBe(0);
    const db = await getDb();
    expect((await db.execute({ sql: "SELECT respondent_user_id FROM cases WHERE id = ?", args: [theirs.id] })).rows[0].respondent_user_id).toBeNull();
  });
});
