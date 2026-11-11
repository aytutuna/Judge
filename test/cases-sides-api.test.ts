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

const dir = mkdtempSync(path.join(tmpdir(), "verdict-cases-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const http = await import("../lib/cases/http");
const { historyHandler } = await import("../lib/history/http");
const ent = await import("../lib/entitlements");
const { getDb } = await import("../lib/db");
const { getCase } = await import("../lib/cases/db");

const { inviteHash, inviteToken } = await import("../lib/cases/invite");
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

async function credits(userId: string): Promise<number> {
  return (await ent.getEntitlement(userId)).credits;
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
  return http.judgeCaseHandler(req("POST", `/api/v1/cases/${id}/judge`, { user: ownerId, body: b, ip: ip() }), id);
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

const SIDES = { "judge-sides": "4" };
const OLD_APP = {};

const manyResult = (parties: ("a" | "b" | "c" | "d")[]) =>
  result({
    parties,
    winner: "a",
    votes: ["a", "a", "other"],
    sides: parties.map((party) => ({ party, claims: [{ claim: `Claim of ${party}`, kind: "fact" as const }], bedrock: `Bedrock ${party}` })),
    others: parties.slice(1).map((party) => ({ party, line: `Party ${party.toUpperCase()} fell short.` })),
  });

/** `links` are the per-side links sent before the one shared link existed
 * (B's is the shared one); `shared` is what the owner sends now. */
async function createMany(ownerId: string, sides: number, extra: Record<string, unknown> = {}) {
  const made = await create(ownerId, { sides, ...extra }, SIDES);
  const id = made.data.case.id;
  const db = await getDb();
  const rows = (await db.execute({ sql: "SELECT party, invite_nonce FROM case_invites WHERE case_id = ?", args: [id] })).rows;
  const links: Record<string, string> = { b: tokenOf(made.data.case) };
  for (const r of rows) links[String(r.party)] = inviteToken(id, String(r.invite_nonce))!;
  return { ...made, links, shared: tokenOf(made.data.case) };
}
async function openLink(token: string, user?: string, claim?: string) {
  const headers: Record<string, string> = { ...SIDES, ...(claim ? { "respondent-claim": claim } : {}) };
  const res = await http.respondOpenHandler(req("POST", `/api/v1/respond/${token}/open`, { user, headers, ip: ip() }), token);
  const data = res.ok ? await body<{ case: CaseView; respondent_claim: string | null }>(res) : null;
  return { res, view: data?.case ?? null, claim: data?.respondent_claim ?? null, party: data?.case.yourParty ?? null };
}
function beat(token: string, user?: string, claim?: string) {
  const headers: Record<string, string> = { ...SIDES, ...(claim ? { "respondent-claim": claim } : {}) };
  return http.respondTypingHandler(req("POST", `/api/v1/respond/${token}/typing`, { user, headers, ip: ip() }), token);
}
function respondAs(token: string, user: string | undefined, text: string, evidence?: string[], claim?: string) {
  return respond(token, {
    user,
    text,
    headers: { ...SIDES, ...(claim ? { "respondent-claim": claim } : {}) },
    ...(evidence ? { evidence } : {}),
  });
}


function judgeSides(ownerId: string, id: string, b: unknown = { mode: "only_mine" }) {
  return http.judgeCaseHandler(req("POST", `/api/v1/cases/${id}/judge`, { user: ownerId, body: b, ip: ip(), headers: SIDES }), id);
}

async function view(token: string, user?: string, claim?: string) {
  const headers: Record<string, string> = { ...SIDES, ...(claim ? { "respondent-claim": claim } : {}) };
  const res = await http.respondGetHandler(req("GET", `/api/v1/respond/${token}`, { user, headers }), token);
  return { res, view: res.ok ? (await body<{ case: CaseView }>(res)).case : null };
}

async function ownerView(ownerId: string, id: string) {
  const res = await http.getCaseHandler(req("GET", `/api/v1/cases/${id}`, { user: ownerId, headers: SIDES }), id);
  return (await body<{ case: CaseView }>(res)).case;
}

describe("a side the case went on without", () => {
  const history = async (user: string, headers: Record<string, string>) => {
    const res = await historyHandler(req("GET", "/api/v1/me/history", { user, headers }));
    return (await body<HistoryResponse>(res)).items;
  };

  it("shuts the link of a side that never answered once the others were judged", async () => {
    const o = await owner(3);
    const { data, links } = await createMany(o, 4);
    await respondAs(links.b, uid(), "Side B answered with enough words to count as an account.");
    await respondAs(links.c, uid(), "Side C answered with enough words to count as an account.");
    expect((await judgeSides(o, data.case.id, { mode: "answered" })).status).toBe(202);
    m.judgeAnonymized.mockResolvedValue(okOutcome(manyResult(["a", "b", "c"])));
    await drain();
    expect((await getCase(data.case.id))?.sides).toBe(3);

    const res = await http.respondGetHandler(req("GET", `/api/v1/respond/${links.d}`, { headers: SIDES }), links.d);
    expect(res.status).toBe(409);
    expect((await body(res)).code).toBe("case_closed");
    expect((await http.respondGetHandler(req("GET", `/api/v1/respond/${links.d}`), links.d)).status).toBe(426);
    expect((await view(links.c)).res.status).toBe(200);
  });

  it("shuts the link of a side that fell away when the case was judged on two", async () => {
    const o = await owner(2);
    const { data, links } = await createMany(o, 3);
    await respondAs(links.b, uid(), "Side B answered with enough words to count as an account.");
    expect((await judgeSides(o, data.case.id, { mode: "answered" })).status).toBe(202);
    await drain();
    for (const headers of [SIDES, OLD_APP]) {
      const res = await http.respondGetHandler(req("GET", `/api/v1/respond/${links.c}`, { headers }), links.c);
      expect(res.status).toBe(409);
    }
  });

  it("leaves a case judged on side A alone out of the history of the sides that had answered", async () => {
    const o = await owner(2);
    const { data, links } = await createMany(o, 3);
    const bob = uid("bob");
    await respondAs(links.b, bob, "Side B answered with enough words to count as an account.");
    expect((await judgeSides(o, data.case.id, { mode: "only_mine" })).status).toBe(202);
    await drain();
    const row = await getCase(data.case.id);
    expect([row?.mode, row?.sides]).toEqual(["one_sided", 2]);
    for (const headers of [SIDES, OLD_APP]) {
      expect((await history(bob, headers)).filter((r) => r.id === data.case.id)).toEqual([]);
    }
    expect((await history(o, SIDES)).find((r) => r.id === data.case.id)?.state).toBe("ready");
  });

  it("sends side C and D only to an app that sends Judge-Sides", async () => {
    const o = await owner(2);
    const { data, links } = await createMany(o, 3);
    const bob = uid("bob");
    const carol = uid("carol");
    await respondAs(links.b, bob, "Side B answered with enough words to count as an account.");
    await respondAs(links.c, carol, "Side C answered with enough words to count as an account.");
    m.judgeAnonymized.mockResolvedValue(okOutcome(manyResult(["a", "b", "c"])));
    await drain();
    const mine = (await history(carol, SIDES)).find((r) => r.id === data.case.id);
    expect([mine?.party, mine?.winner, mine?.parties]).toEqual(["c", "a", ["a", "b", "c"]]);
    for (const user of [bob, carol, o]) expect((await history(user, OLD_APP)).filter((r) => r.id === data.case.id)).toEqual([]);
  });

  it("judges the sides that answered after the invites expired, with a fresh unit", async () => {
    const o = await owner(1);
    const { data, links } = await createMany(o, 3);
    const id = data.case.id;
    expect(await credits(o)).toBe(0);
    await respondAs(links.b, uid(), "Side B answered with enough words to count as an account.");
    const db = await getDb();
    await db.execute({ sql: "UPDATE cases SET expires_at = ? WHERE id = ?", args: [new Date(Date.now() - 60_000).toISOString(), id] });

    const expired = await ownerView(o, id);
    expect([expired.status, expired.canJudgeAnswered, expired.canJudgeNow]).toEqual(["expired", true, true]);
    const go = await judgeSides(o, id, { mode: "answered" });
    expect(go.status).toBe(202);
    expect((await ownerView(o, id)).status).toBe("judging");
    await drain();
    const done = await ownerView(o, id);
    expect([done.status, done.mode, done.parties]).toEqual(["judged", "two_sided", undefined]);
    expect(await credits(o)).toBe(0);
    expect((await judgeSides(o, id, { mode: "answered" })).status).toBe(200);
  });

  it("does not judge an expired case whose answers skip a side", async () => {
    const o = await owner(2);
    const { data, links } = await createMany(o, 3);
    const id = data.case.id;
    await respondAs(links.c, uid(), "Side C answered first, with enough words to count as an account.");
    const db = await getDb();
    await db.execute({ sql: "UPDATE cases SET expires_at = ? WHERE id = ?", args: [new Date(Date.now() - 60_000).toISOString(), id] });
    expect((await ownerView(o, id)).canJudgeAnswered).toBe(false);
    expect((await judgeSides(o, id, { mode: "answered" })).status).toBe(400);
  });

  it("tells the judges which invited sides did not answer", async () => {
    const o = await owner(2);
    const { data, links } = await createMany(o, 4);
    await respondAs(links.b, uid(), "Side B answered with enough words to count as an account.");
    await respondAs(links.c, uid(), "Side C answered with enough words to count as an account.");
    await judgeSides(o, data.case.id, { mode: "answered" });
    m.judgeAnonymized.mockResolvedValue(okOutcome(manyResult(["a", "b", "c"])));
    await drain();
    const input = m.judgeAnonymized.mock.calls[0][0] as { text: string };
    expect(input.text).toContain("NOT HEARD: invited but did not answer: Party D.");
  });

  it("adds that note on the two-sided path too, and not when everyone answered", async () => {
    const o = await owner(3);
    const two = await createMany(o, 3);
    await respondAs(two.links.b, uid(), "Side B answered with enough words to count as an account.");
    await judgeSides(o, two.data.case.id, { mode: "answered" });
    await drain();
    expect((m.judgeAnonymized.mock.calls[0][0] as { text: string }).text).toContain("NOT HEARD: invited but did not answer: Party C.");

    m.judgeAnonymized.mockClear();
    const full = await createMany(o, 3);
    await respondAs(full.links.b, uid(), "Side B answered with enough words to count as an account.");
    await respondAs(full.links.c, uid(), "Side C answered with enough words to count as an account.");
    m.judgeAnonymized.mockResolvedValue(okOutcome(manyResult(["a", "b", "c"])));
    await drain();
    expect((m.judgeAnonymized.mock.calls[0][0] as { text: string }).text).not.toContain("NOT HEARD");
  });
});

describe("a case with three or four sides", () => {
  it("is created only by a client that sends the capability header", async () => {
    const o = await owner(3);
    for (const headers of [OLD_APP, { "judge-sides": "2" }, { "judge-sides": "3x" }]) {
      const refused = await create(o, { sides: 3 }, headers);
      expect(refused.res.status).toBe(426);
      expect(refused.data.code).toBe("update_required");
    }
    expect((await create(o, { sides: 4 }, { "judge-sides": "3" })).res.status).toBe(426);
    expect((await create(o, { sides: 3 }, { "judge-sides": "3" })).res.status).toBe(201);
    expect(await credits(o)).toBe(2);
  });

  it("gives every other side the one link and holds one unit", async () => {
    const o = await owner(2);
    const { res, data, links, shared } = await createMany(o, 4);
    expect(res.status).toBe(201);
    const c = data.case;
    expect(c.parties).toEqual(["a", "b", "c", "d"]);
    expect(c.invites?.map((i) => [i.party, i.status])).toEqual([["b", "waiting"], ["c", "waiting"], ["d", "waiting"]]);
    // Older apps read a link per side; they all point at the same one.
    expect(new Set(c.invites!.map((i) => i.inviteUrl))).toEqual(new Set([c.inviteUrl]));
    expect(links.b).toBe(shared);
    expect(c.live).toEqual([
      { party: "b", state: "waiting" },
      { party: "c", state: "waiting" },
      { party: "d", state: "waiting" },
    ]);
    expect(await credits(o)).toBe(1);
    expect(await count("SELECT count(*) AS n FROM case_invites WHERE case_id = ?", [c.id])).toBe(2);
    const db = await getDb();
    const stored = (await db.execute({ sql: "SELECT invite_hash FROM case_invites WHERE case_id = ?", args: [c.id] })).rows.map((r) => String(r.invite_hash));
    expect(stored.sort()).toEqual([inviteHash(links.c), inviteHash(links.d)].sort());
  });

  it("answers an older client with update_required and keeps it out of its list", async () => {
    const o = await owner(3);
    const many = await createMany(o, 3);
    const plain = await create(o);
    const id = many.data.case.id;

    const get = await http.getCaseHandler(req("GET", `/api/v1/cases/${id}`, { user: o }), id);
    expect(get.status).toBe(426);
    expect((await body(get)).code).toBe("update_required");
    for (const t of [many.links.b, many.links.c]) {
      const r = await http.respondGetHandler(req("GET", `/api/v1/respond/${t}`, {}), t);
      expect(r.status).toBe(426);
      const post = await respond(t, { user: uid() });
      expect(post.status).toBe(426);
    }
    const judge = await judgeNow(o, id);
    expect(judge.status).toBe(426);

    const list = async (headers: Record<string, string>) =>
      (await body<{ cases: { id: string; parties?: string[] }[] }>(await http.listCasesHandler(req("GET", "/api/v1/cases", { user: o, headers })))).cases;
    expect((await list(OLD_APP)).map((x) => x.id)).toEqual([plain.data.case.id]);
    const all = await list(SIDES);
    expect(all.map((x) => x.id).sort()).toEqual([id, plain.data.case.id].sort());
    expect(all.find((x) => x.id === id)?.parties).toEqual(["a", "b", "c"]);
    expect(all.find((x) => x.id === plain.data.case.id)?.parties).toBeUndefined();

    // A two-sided case is untouched: no header needed, no new fields.
    const old = await getRespondent(tokenOf(plain.data.case));
    expect(old.res.status).toBe(200);
    expect(old.view?.parties).toBeUndefined();
    expect(old.view?.invites).toBeUndefined();
  });

  it("writes each side through its own link and judges when the last one lands", async () => {
    const o = await owner(2);
    const { data, links } = await createMany(o, 3);
    const id = data.case.id;
    const bob = uid("bob");
    const carol = uid("carol");

    const b = await respondAs(links.b, bob, "Bob here: I think I am right, Deniz was late.");
    expect(b.status).toBe(202);
    expect((await body<{ case: CaseView }>(b)).case.yourParty).toBe("b");
    expect((await ownerView(o, id)).status).toBe("awaiting_respondent");
    expect(m.scheduled).toHaveLength(0);
    const waiting = await ownerView(o, id);
    expect(waiting.invites?.map((i) => [i.party, i.status, i.inviteUrl === null])).toEqual([["b", "answered", true], ["c", "waiting", false]]);
    expect(waiting.canJudgeAnswered).toBe(true);

    const c = await respondAs(links.c, carol, "Carol says it was all a misunderstanding.");
    expect(c.status).toBe(202);
    expect((await body<{ case: CaseView }>(c)).case.yourParty).toBe("c");
    expect(m.scheduled).toHaveLength(1);
    expect((await ownerView(o, id)).status).toBe("judging");
    m.judgeAnonymized.mockResolvedValue(okOutcome(manyResult(["a", "b", "c"])));
    await drain();

    const input = m.judgeAnonymized.mock.calls[0][0] as { text: string; parties?: string[]; twoSided?: boolean };
    expect(input.parties).toEqual(["a", "b", "c"]);
    expect(input.text).toMatch(/PARTY A/i);
    expect(input.text).toMatch(/PARTY B/i);
    expect(input.text).toMatch(/PARTY C/i);
    const done = await ownerView(o, id);
    expect(done.status).toBe("judged");
    expect(done.sides.map((s) => s.party)).toEqual(["a", "b", "c"]);
    expect(done.verdicts[0].result?.winner).toBe("a");
    // Each answering side sees all three accounts once it is judged.
    expect((await view(links.c, carol)).view?.sides).toHaveLength(3);
    expect((await view(links.b, bob)).view?.yourParty).toBe("b");
  });

  it("keeps every account from the other sides until judging", async () => {
    const o = await owner(2);
    const { data, links } = await createMany(o, 3);
    const bob = uid("bob");
    const bobAnswer = await respondAs(links.b, bob, "Bob's private account of events.");
    expect(bobAnswer.status).toBe(202);

    const asC = await view(links.c, uid("carol"));
    expect(asC.view?.sides).toEqual([]);
    expect(asC.view?.yourParty).toBe("c");
    const asB = await view(links.b, bob);
    expect(asB.view?.sides).toEqual([]);
    expect((await ownerView(o, data.case.id)).sides.map((s) => s.party)).toEqual(["a"]);
    // The link for C does not open B's originals, with or without B's account.
    const originals = await http.respondOriginalsHandler(req("GET", `/api/v1/respond/${links.c}/originals`, { user: bob, headers: SIDES }), links.c);
    expect(originals.status).toBe(403);
  });

  it("lets one person answer for one side, and never the owner for another", async () => {
    const o = await owner(2);
    const { data, links } = await createMany(o, 4);
    const bob = uid("bob");
    expect((await respondAs(links.b, bob, "Bob's side of the story.")).status).toBe(202);

    const again = await respondAs(links.c, bob, "Bob also tries to be the third side.");
    expect(again.status).toBe(403);
    expect((await body(again)).code).toBe("not_party");
    const byOwner = await respondAs(links.c, o, "The owner tries to be side C.");
    expect(byOwner.status).toBe(403);
    expect(await count("SELECT count(*) AS n FROM case_sides WHERE case_id = ?", [data.case.id])).toBe(2);

    // Signed out, then claimed: the claim says which side it is.
    const signedOut = await respondAs(links.c, undefined, "Carol writes without an account.");
    const claim = (await body<{ respondent_claim?: string }>(signedOut)).respondent_claim;
    expect(signedOut.status).toBe(202);
    expect(claim).toBeTruthy();
    const claimAs = (user: string) =>
      http.respondentClaimHandler(req("POST", `/api/v1/cases/${data.case.id}/claim`, { user, body: { claim }, ip: ip(), headers: SIDES }), data.case.id);
    expect((await claimAs(bob)).status).toBe(404);
    expect((await claimAs(o)).status).toBe(404);
    const carol = uid("carol");
    expect((await claimAs(carol)).status).toBe(200);
    expect((await claimAs(carol)).status).toBe(200);
    expect((await claimAs(uid("mallory"))).status).toBe(404);
    const db = await getDb();
    expect(String((await db.execute({ sql: "SELECT user_id FROM case_invites WHERE case_id = ? AND party = 'c'", args: [data.case.id] })).rows[0].user_id)).toBe(carol);
    // And carol cannot now take side D.
    expect((await respondAs(links.d, carol, "Carol as the fourth side.")).status).toBe(403);
  });

  it("judges the sides that answered when the owner goes ahead", async () => {
    const o = await owner(3);
    const { data, links } = await createMany(o, 4);
    const id = data.case.id;
    expect((await judgeSides(o, id, {})).status).toBe(400);
    expect((await judgeSides(o, id, { mode: "answered" })).status).toBe(400);
    expect((await ownerView(o, id)).canJudgeAnswered).toBe(false);

    await respondAs(links.b, uid(), "Side B answered with enough words to count as an account.");
    await respondAs(links.c, uid(), "Side C answered with enough words to count as an account.");
    expect((await ownerView(o, id)).canJudgeAnswered).toBe(true);
    const go = await judgeSides(o, id, { mode: "answered" });
    expect(go.status).toBe(202);
    const judging = await ownerView(o, id);
    expect(judging.status).toBe("judging");
    expect(judging.parties).toEqual(["a", "b", "c"]);
    m.judgeAnonymized.mockResolvedValue(okOutcome(manyResult(["a", "b", "c"])));
    await drain();
    expect((await m.judgeAnonymized.mock.calls[0][0] as { parties?: string[] }).parties).toEqual(["a", "b", "c"]);
    // The link of the side that never answered is closed now.
    const late = await respondAs(links.d, uid(), "Too late, but with enough words to count as an account.");
    expect(late.status).toBe(409);
  });

  it("goes ahead as an ordinary two-sided case when only side B answered", async () => {
    const o = await owner(2);
    const { data, links } = await createMany(o, 3);
    await respondAs(links.b, uid(), "Side B answered with enough words to count as an account.");
    expect((await judgeSides(o, data.case.id, { mode: "answered" })).status).toBe(202);
    await drain();
    const input = m.judgeAnonymized.mock.calls[0][0] as { parties?: string[]; twoSided?: boolean };
    expect(input.parties).toBeUndefined();
    expect(input.twoSided).toBe(true);
    const row = await getCase(data.case.id);
    expect(row?.sides).toBe(2);
  });

  it("does not skip a side: C answering without B cannot be judged on its own", async () => {
    const o = await owner(2);
    const { data, links } = await createMany(o, 3);
    await respondAs(links.c, uid(), "Side C answered first, with enough words to count as an account.");
    expect((await ownerView(o, data.case.id)).canJudgeAnswered).toBe(false);
    expect((await judgeSides(o, data.case.id, { mode: "answered" })).status).toBe(400);
  });

  it("replaces the one link while a side is open and keeps the seats already taken", async () => {
    const o = await owner(2);
    const { data, shared } = await createMany(o, 3);
    const id = data.case.id;
    const rotate = (party?: string) =>
      http.rotateInviteHandler(req("POST", `/api/v1/cases/${id}/invite`, { user: o, headers: SIDES, ip: ip(), ...(party ? { body: { party } } : {}) }), id);

    const bob = await openLink(shared, uid("bob"));
    const res = await rotate();
    expect(res.status).toBe(200);
    const fresh = (await body<{ inviteUrl: string }>(res)).inviteUrl.split("/r/")[1];
    expect(fresh).not.toBe(shared);
    expect((await view(shared)).res.status).toBe(404);
    expect((await ownerView(o, id)).invites?.every((i) => i.inviteUrl?.endsWith(fresh))).toBe(true);
    // Older apps still name a side; the answer is the one link either way.
    const named = await body<{ inviteUrl: string; party: string }>(await rotate("c"));
    expect(named.party).toBe("c");
    const now = named.inviteUrl.split("/r/")[1];
    // Bob's claim does not depend on the link: it finds his seat on the new one.
    const again = await openLink(now, undefined, bob.claim!);
    expect([again.party, again.claim]).toEqual(["b", bob.claim]);
    expect((await rotate("a")).status).toBe(400);

    await respondAs(now, undefined, "Bob answers on the new link, with enough words to count.", undefined, bob.claim!);
    await respondAs(now, undefined, "Carol answers on the new link, with enough words to count.");
    expect((await rotate()).status).toBe(409);
  });

  it("binds an evidence token to the side whose link it came from", async () => {
    const o = await owner(2);
    const { data, links } = await createMany(o, 3);
    const id = data.case.id;
    const forB = await respondAs(links.c, uid(), "Side C with side B's screenshot.", [`good:r:${id}`]);
    expect(forB.status).toBe(400);
    expect((await body(forB)).code).toBe("evidence_invalid");
    const forC = await respondAs(links.c, uid(), "Side C with its own screenshot.", [`good:r:${id}:c`]);
    expect(forC.status).toBe(202);
    const viaB = await respondAs(links.b, uid(), "Side B with side B's screenshot.", [`good:r:${id}`]);
    expect(viaB.status).toBe(202);
  });

  it("still answers an existing two-sided link exactly as before", async () => {
    const o = await owner(2);
    const { data } = await create(o);
    const token = tokenOf(data.case);
    const row = await getCase(data.case.id);
    expect(row?.sides).toBe(2);
    const res = await respond(token, { user: uid() });
    expect(res.status).toBe(202);
    expect(await count("SELECT count(*) AS n FROM case_invites WHERE case_id = ?", [data.case.id])).toBe(0);
    await drain();
    expect((await getOwner(o, data.case.id)).status).toBe("judged");
    const input = m.judgeAnonymized.mock.calls[0][0] as { parties?: string[] };
    expect(input.parties).toBeUndefined();
  });
});

describe("one link for every side", () => {
  const BOB = "Bob here: I think I am right, Deniz was late.";

  const live = async (o: string, id: string) => (await ownerView(o, id)).live;

  it("gives the next open side to whoever opens it, in order, until the case is full", async () => {
    const o = await owner(2);
    const { data, shared } = await createMany(o, 3);
    const first = await openLink(shared, uid("bob"));
    const second = await openLink(shared, uid("carol"));
    expect([first.party, second.party]).toEqual(["b", "c"]);
    expect(first.claim).toBeTruthy();
    expect(first.claim).not.toBe(second.claim);
    expect(await live(o, data.case.id)).toEqual([
      { party: "b", state: "opened" },
      { party: "c", state: "opened" },
    ]);

    const late = await openLink(shared, uid("dave"));
    expect(late.res.status).toBe(409);
    expect(((await body(late.res)) as { code: string }).code).toBe("case_closed");
    expect((await view(shared)).res.status).toBe(409);
    expect((await respondAs(shared, uid("dave"), "Dave arrives after the case is full, with enough words.")).status).toBe(409);
  });

  it("never gives two people at once the same side", async () => {
    const o = await owner(2);
    const { data, shared } = await createMany(o, 4);
    const users = [uid("u1"), uid("u2"), uid("u3"), uid("u4"), uid("u5")];
    const results = await Promise.all(users.map((u) => openLink(shared, u)));
    const won = results.filter((r) => r.res.ok).map((r) => r.party);
    expect(won.sort()).toEqual(["b", "c", "d"]);
    expect(results.filter((r) => !r.res.ok).map((r) => r.res.status)).toEqual([409, 409]);
    expect(await count("SELECT count(*) AS n FROM case_seats WHERE case_id = ?", [data.case.id])).toBe(3);
  });

  it("puts two answers that arrive together on different sides", async () => {
    const o = await owner(2);
    const { data, shared } = await createMany(o, 3);
    const answers = await Promise.all([
      respondAs(shared, uid("bob"), "Bob answers at the same moment, with enough words to count."),
      respondAs(shared, uid("carol"), "Carol answers at the same moment, with enough words to count."),
    ]);
    expect(answers.map((r) => r.status)).toEqual([202, 202]);
    const parties = await Promise.all(answers.map(async (r) => (await body<{ case: CaseView }>(r)).case.yourParty));
    expect(parties.sort()).toEqual(["b", "c"]);
    expect(await count("SELECT count(*) AS n FROM case_sides WHERE case_id = ?", [data.case.id])).toBe(3);
  });

  it("sends a person who opens the link again back to their own side", async () => {
    const o = await owner(2);
    const { shared } = await createMany(o, 3);
    const bob = uid("bob");
    const bobOpen = await openLink(shared, bob);
    await openLink(shared, uid("carol"));

    const byClaim = await openLink(shared, undefined, bobOpen.claim!);
    expect([byClaim.party, byClaim.claim]).toEqual(["b", bobOpen.claim]);
    const byAccount = await openLink(shared, bob);
    expect([byAccount.party, byAccount.claim]).toEqual(["b", bobOpen.claim]);
    expect((await view(shared, bob)).view?.yourParty).toBe("b");
    expect((await view(shared, undefined, bobOpen.claim!)).view?.yourParty).toBe("b");

    // The claim keeps meaning the same side after answering.
    const answer = await respondAs(shared, undefined, BOB, undefined, bobOpen.claim!);
    expect(answer.status).toBe(202);
    const data = await body<{ case: CaseView; respondent_claim?: string }>(answer);
    expect([data.case.yourParty, data.respondent_claim]).toEqual(["b", bobOpen.claim]);
    const after = await openLink(shared, undefined, bobOpen.claim!);
    expect([after.party, after.claim]).toEqual(["b", bobOpen.claim]);
  });

  it("does not hand a side out by looking, and never to the owner", async () => {
    const o = await owner(2);
    const { data, shared } = await createMany(o, 3);
    const peek = await view(shared, uid("bob"));
    expect(peek.view?.yourParty).toBe("b");
    expect(await count("SELECT count(*) AS n FROM case_seats WHERE case_id = ?", [data.case.id])).toBe(0);
    const mine = await openLink(shared, o);
    expect([mine.res.status, mine.claim, mine.view?.ownInvite]).toEqual([200, null, true]);
    expect(await count("SELECT count(*) AS n FROM case_seats WHERE case_id = ?", [data.case.id])).toBe(0);
    expect((await respondAs(shared, o, "The owner answers their own link, with enough words.")).status).toBe(403);
  });

  it("answers an app that never opens the link, and a failed answer does not use up a side", async () => {
    const o = await owner(2);
    const { data, shared } = await createMany(o, 3);
    m.anonymizeSubmission.mockRejectedValueOnce(new Error("upstream failed"));
    const failed = await respondAs(shared, undefined, "This answer fails the anonymizer, with enough words to count.");
    expect(failed.status).toBe(503);
    expect(await count("SELECT count(*) AS n FROM case_seats WHERE case_id = ?", [data.case.id])).toBe(0);
    const ok = await respondAs(shared, undefined, "Now it works, with enough words to count as an account.");
    expect((await body<{ case: CaseView }>(ok)).case.yourParty).toBe("b");
  });

  it("lets a side that was opened and abandoned go to the next person, but not one held by an account", async () => {
    const o = await owner(2);
    const { data, shared } = await createMany(o, 3);
    const db = await getDb();
    const old = new Date(Date.now() - 45 * 60_000).toISOString();
    const gone = await openLink(shared);
    const bob = await openLink(shared, uid("bob"));
    expect([gone.party, bob.party]).toEqual(["b", "c"]);
    await db.execute({ sql: "UPDATE case_seats SET opened_at = ? WHERE case_id = ?", args: [old, data.case.id] });

    const next = await openLink(shared);
    expect(next.party).toBe("b");
    expect(next.claim).not.toBe(gone.claim);
    expect((await beat(shared, undefined, gone.claim!)).status).toBe(404);
    expect((await beat(shared, undefined, next.claim!)).status).toBe(200);
    // C belongs to an account, so a stranger finds the case full instead.
    expect((await openLink(shared, uid("eve"))).res.status).toBe(409);
  });

  it("reports typing only while heartbeats are recent, and nothing else", async () => {
    const o = await owner(2);
    const { data, shared } = await createMany(o, 3);
    const id = data.case.id;
    const bob = await openLink(shared, uid("bob"));
    expect((await live(o, id))?.[0].state).toBe("opened");

    const sent = await beat(shared, undefined, bob.claim!);
    expect(sent.status).toBe(200);
    expect(await body(sent)).toEqual({ ok: true });
    const seen = await ownerView(o, id);
    expect(seen.live?.[0]).toEqual({ party: "b", state: "typing" });
    expect(seen.pollAfterMs).toBe(3000);
    expect(Object.keys(seen.live![0]).sort()).toEqual(["party", "state"]);
    expect(JSON.stringify(seen)).not.toMatch(/typing_at|typingAt/);

    const db = await getDb();
    await db.execute({ sql: "UPDATE case_seats SET typing_at = ? WHERE case_id = ?", args: [new Date(Date.now() - 10_000).toISOString(), id] });
    expect((await live(o, id))?.[0].state).toBe("opened");
  });

  it("takes a heartbeat only from the holder of a side of that case", async () => {
    const o = await owner(3);
    const { data, shared } = await createMany(o, 3);
    const other = await createMany(o, 3);
    const bob = await openLink(shared, uid("bob"));
    const carol = await openLink(other.shared, uid("carol"));
    const id = data.case.id;
    const state = async () => (await live(o, id))?.[0].state;

    expect((await beat(shared)).status).toBe(404);
    expect((await beat(shared, undefined, "x".repeat(22))).status).toBe(404);
    expect((await beat(shared, o)).status).toBe(404);
    expect((await beat(shared, uid("mallory"))).status).toBe(404);
    expect((await beat(shared, undefined, carol.claim!)).status).toBe(404);
    expect((await beat("a".repeat(22))).status).toBe(404);
    expect(await state()).toBe("opened");

    expect((await beat(shared, undefined, bob.claim!)).status).toBe(200);
    expect(await state()).toBe("typing");
    // Once answered, a heartbeat has nothing to say.
    await respondAs(shared, undefined, BOB, undefined, bob.claim!);
    expect((await beat(shared, undefined, bob.claim!)).status).toBe(409);
  });

  it("limits the heartbeat per side", async () => {
    const o = await owner(2);
    const { shared } = await createMany(o, 3);
    const bob = await openLink(shared, uid("bob"));
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) codes.push((await beat(shared, undefined, bob.claim!)).status);
    expect(codes.filter((c) => c === 200)).toHaveLength(30);
    expect(codes.slice(30)).toEqual([429, 429]);
    const carol = await openLink(shared, uid("carol"));
    expect((await beat(shared, undefined, carol.claim!)).status).toBe(200);
  });

  it("shows the owner waiting, opened, typing and answered per side", async () => {
    const o = await owner(2);
    const { data, shared } = await createMany(o, 3);
    const id = data.case.id;
    expect((await ownerView(o, id)).live).toEqual([
      { party: "b", state: "waiting" },
      { party: "c", state: "waiting" },
    ]);
    const bob = await openLink(shared, uid("bob"));
    const carol = await openLink(shared, uid("carol"));
    await beat(shared, undefined, carol.claim!);
    expect((await ownerView(o, id)).live).toEqual([
      { party: "b", state: "opened" },
      { party: "c", state: "typing" },
    ]);
    await respondAs(shared, undefined, BOB, undefined, bob.claim!);
    const half = await ownerView(o, id);
    expect(half.live).toEqual([
      { party: "b", state: "answered" },
      { party: "c", state: "typing" },
    ]);
    expect(half.pollAfterMs).toBe(3000);
    expect(half.inviteUrl).not.toBeNull();
    await respondAs(shared, undefined, "Carol answers now, with enough words to count as an account.", undefined, carol.claim!);
    const done = await ownerView(o, id);
    expect(done.live?.map((l) => l.state)).toEqual(["answered", "answered"]);
    expect(done.inviteUrl).toBeNull();
    expect((await view(shared, undefined, bob.claim!)).view?.live).toBeUndefined();
  });

  it("works for a two-sided case too, which older apps still answer as before", async () => {
    const o = await owner(2);
    const { data } = await create(o);
    const token = tokenOf(data.case);
    expect(data.case.live).toEqual([{ party: "b", state: "waiting" }]);
    const opened = await openLink(token, uid("bob"));
    expect(opened.party).toBe("b");
    expect((await openLink(token, uid("carol"))).res.status).toBe(409);
    expect((await getOwner(o, data.case.id)).live).toEqual([{ party: "b", state: "opened" }]);
    const answer = await respondAs(token, undefined, BOB, undefined, opened.claim!);
    expect(answer.status).toBe(202);
  });

  it("lists the live states of the owner's waiting cases", async () => {
    const o = await owner(3);
    const waiting = await createMany(o, 3);
    const two = await create(o);
    const done = await createMany(o, 3);
    await judgeSides(o, done.data.case.id, { mode: "only_mine" });
    await drain();
    await openLink(waiting.shared, uid("bob"));
    const list = (user?: string) => http.liveCasesHandler(req("GET", "/api/v1/cases/live", { user, ip: ip() }));
    expect((await list()).status).toBe(401);
    const res = await list(o);
    expect(res.status).toBe(200);
    const cases = (await body<{ cases: { id: string; sides: unknown[] }[] }>(res)).cases;
    expect(cases.map((c) => c.id).sort()).toEqual([waiting.data.case.id, two.data.case.id].sort());
    expect(cases.find((c) => c.id === waiting.data.case.id)?.sides).toEqual([
      { party: "b", state: "opened" },
      { party: "c", state: "waiting" },
    ]);
    expect((await body<{ cases: unknown[] }>(await list(uid("someone")))).cases).toEqual([]);
  });
});
