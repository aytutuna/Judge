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
const ent = await import("../lib/entitlements");
const { getDb } = await import("../lib/db");
const { getCase } = await import("../lib/cases/db");

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

async function createMany(ownerId: string, sides: number, extra: Record<string, unknown> = {}) {
  const made = await create(ownerId, { sides, ...extra }, SIDES);
  const links = Object.fromEntries((made.data.case.invites ?? []).map((i) => [i.party, i.inviteUrl!.split("/r/")[1]]));
  return { ...made, links };
}
function respondAs(token: string, user: string | undefined, text: string, evidence?: string[]) {
  return respond(token, { user, text, headers: SIDES, ...(evidence ? { evidence } : {}) });
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

  it("gives each other side its own link and one held unit", async () => {
    const o = await owner(2);
    const { res, data, links } = await createMany(o, 4);
    expect(res.status).toBe(201);
    const c = data.case;
    expect(c.parties).toEqual(["a", "b", "c", "d"]);
    expect(c.invites?.map((i) => [i.party, i.status])).toEqual([["b", "waiting"], ["c", "waiting"], ["d", "waiting"]]);
    expect(new Set(Object.values(links)).size).toBe(3);
    expect(c.inviteUrl).toBe(c.invites![0].inviteUrl);
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

  it("replaces one side's link without touching the others", async () => {
    const o = await owner(2);
    const { data, links } = await createMany(o, 3);
    const id = data.case.id;
    const rotate = (party?: string) =>
      http.rotateInviteHandler(req("POST", `/api/v1/cases/${id}/invite`, { user: o, headers: SIDES, ip: ip(), ...(party ? { body: { party } } : {}) }), id);

    const res = await rotate("c");
    expect(res.status).toBe(200);
    const out = await body<{ inviteUrl: string; party: string }>(res);
    expect(out.party).toBe("c");
    const fresh = out.inviteUrl.split("/r/")[1];
    expect(fresh).not.toBe(links.c);
    expect((await view(links.c)).res.status).toBe(404);
    expect((await view(fresh)).view?.yourParty).toBe("c");
    expect((await view(links.b)).view?.yourParty).toBe("b");
    expect((await ownerView(o, id)).invites?.find((i) => i.party === "c")?.inviteUrl).toBe(out.inviteUrl);

    const noBody = await body<{ party: string }>(await rotate());
    expect(noBody.party).toBe("b");
    expect((await view(links.b)).res.status).toBe(404);
    const wrong = await rotate("d");
    expect(wrong.status).toBe(409);
    const nonsense = await rotate("a");
    expect(nonsense.status).toBe(400);
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