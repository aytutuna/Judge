import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/v1/me/history against a real (temporary) database: one-sided
 * verdicts and their jobs and rounds, cases started and answered, merged
 * with one cursor; access per viewer. Model calls, sessions, Turnstile and
 * the evidence package are mocked; background judging runs with drain().
 */

const m = vi.hoisted(() => ({
  getViewer: vi.fn(),
  isSameOrigin: vi.fn(),
  verifyTurnstile: vi.fn(),
  anonymizeSubmission: vi.fn(),
  judgeAnonymized: vi.fn(),
  checkUserLimits: vi.fn(),
  scheduled: [] as (() => Promise<void>)[],
}));

vi.mock("@/lib/auth", () => ({
  getViewer: m.getViewer,
  isSameOrigin: m.isSameOrigin,
  authConfigured: () => true,
  resolveViewer: async (req: Request) => ({ viewer: (await m.getViewer(req)) ?? null, deadBearer: false }),
  hasDeadBearer: async () => false,
  premiumEnabled: (env: Record<string, string | undefined> = process.env) => env.PREMIUM_ENABLED?.trim() !== "0",
  derivedSecret: (purpose: string) => createHmac("sha256", "test-secret").update(purpose).digest(),
  getAuth: vi.fn(),
}));
vi.mock("@/lib/ratelimit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ratelimit")>();
  m.checkUserLimits.mockImplementation(real.checkUserLimits);
  return { ...real, checkUserLimits: m.checkUserLimits };
});
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: m.verifyTurnstile }));
vi.mock("@/lib/evidence", () => ({
  anonymizeSubmission: m.anonymizeSubmission,
  verifyEvidenceTokens: () => ({ ok: false, code: "evidence_invalid" }),
  handleEvidenceUpload: vi.fn(),
  caseNameKeys: () => (name: string) => [`key:${name.toLowerCase()}`],
  evidenceBlock: () => null,
}));
vi.mock("@/lib/premium/run", () => ({
  judgeAnonymized: m.judgeAnonymized,
  premiumLogLine: () => "[premium] test",
}));
vi.mock("@/lib/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/claude")>()),
  claudeJson: async () => ({ ok: true, data: { summary: "The receipt settled it." } }),
}));
vi.mock("@/lib/cases/schedule", () => ({
  scheduleJudging: (fn: () => Promise<void>) => {
    m.scheduled.push(fn);
  },
}));

const dir = mkdtempSync(path.join(tmpdir(), "verdict-history-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const http = await import("../lib/cases/http");
const { historyHandler, decodeCursor, encodeCursor } = await import("../lib/history/http");
const ent = await import("../lib/entitlements");
const { getDb } = await import("../lib/db");
const { saveVerdictWithOriginals } = await import("../lib/originals/save");
const { getVerdictMeta } = await import("../lib/originals/db");
const { removeVerdict } = await import("../lib/originals/removal");
const jobs = await import("../lib/verdict-jobs");
import type { CaseView } from "../lib/case-types";
import type { HistoryResponse, HistoryRow } from "../lib/history-types";
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
const ip = () => `10.1.${Math.floor(++n / 250)}.${n % 250}`;

const RESULT: VerdictResult = {
  verdict: "side_a",
  dispute_type: "factual",
  headline: "Party A paid",
  crux: "Whether the April bill was paid",
  split_points: null,
  conditional: null,
  argument_map: { side_a: [{ claim: "Paid", kind: "fact" }], side_b: [{ claim: "Unpaid", kind: "fact" }], bedrock_a: "a", bedrock_b: "b" },
  facts_relied_on: [],
  losing_side_best_point: "The account showed it unpaid",
  confidence: 4,
  runs: ["side_a", "side_a", "side_b"],
  demo: false,
  tier: "premium",
  lang: "en",
  agreed_facts: ["There was a bill"],
  disputed_facts: [
    { fact: "Was it paid?", party_a: "Yes", party_b: "No", finding: "unsettled", decisive: true },
    { fact: "Second", party_a: "x", party_b: "y", finding: "a", decisive: true },
  ],
  would_change: ["A bank record"],
};

type Opts = { user?: string; via?: "cookie" | "bearer"; body?: unknown; headers?: Record<string, string>; ip?: string };

function req(method: string, url: string, opts: Opts = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json", ...opts.headers };
  if (opts.user) headers["x-test-user"] = opts.user;
  if (opts.via) headers["x-test-via"] = opts.via;
  headers["x-forwarded-for"] = opts.ip ?? "192.0.2.1";
  return new Request(`${ORIGIN}${url}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function body<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function drain(): Promise<void> {
  while (m.scheduled.length) await m.scheduled.shift()!();
}

async function sql(text: string, args: (string | number | null)[] = []) {
  const db = await getDb();
  return db.execute({ sql: text, args });
}

async function owner(credits = 3): Promise<string> {
  const id = uid("owner");
  await ent.grantCredits({ userId: id, credits, source: "admin", externalId: `g:${id}` });
  return id;
}

async function startCase(ownerId: string): Promise<CaseView> {
  const res = await http.createCaseHandler(req("POST", "/api/v1/cases", { user: ownerId, body: { text: SIDE_A, lang: "en" } }));
  return (await body<{ case: CaseView }>(res)).case;
}

const tokenOf = (view: CaseView) => view.inviteUrl!.split("/r/")[1];

async function answer(token: string, user?: string): Promise<string | undefined> {
  const res = await http.respondPostHandler(
    req("POST", `/api/v1/respond/${token}`, {
      ...(user ? { user, via: "bearer" as const } : {}),
      ip: ip(),
      body: { text: SIDE_B, turnstileToken: "t" },
    }),
    token,
  );
  expect(res.status).toBe(202);
  return (await body<{ respondent_claim?: string }>(res)).respondent_claim;
}

async function saveVerdict(userId: string, id = uid("v")) {
  await saveVerdictWithOriginals({
    id,
    input: "Party B says Party A owes him",
    result: RESULT,
    kind: "premium",
    ownerUserId: userId,
    original: { v: 1, text: "Harry says I owe him", nameMap: [{ original: "I", replacement: "Party A" }, { original: "Harry", replacement: "Party B" }] },
  });
  return id;
}

async function list(user: string | undefined, q = ""): Promise<{ res: Response; data: HistoryResponse }> {
  const res = await historyHandler(req("GET", `/api/v1/me/history${q}`, { user }));
  return { res, data: res.ok ? await body<HistoryResponse>(res) : (null as never) };
}

/** Every row for a user, following the cursor. */
async function all(user: string, limit = 50): Promise<HistoryRow[]> {
  const rows: HistoryRow[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 100; i++) {
    const { data } = await list(user, `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    rows.push(...data.items);
    cursor = data.next;
    if (!cursor) return rows;
  }
  throw new Error("cursor never ended");
}

const keys = (rows: HistoryRow[]) => rows.map((r) => `${r.kind === "verdict" ? "v" : "c"}:${r.id}`);

beforeEach(() => {
  m.scheduled.length = 0;
  vi.stubEnv("CASES_ENABLED", "");
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
  m.anonymizeSubmission.mockImplementation(async (input: { narrator: string; text: string }) => {
    const other = input.narrator === "Party A" ? "Party B" : "Party A";
    return {
      text: input.text.replace(/\bI\b/g, input.narrator).replace(/Deniz|my partner/g, other),
      evidence: [],
      nameMap: [
        { original: "I", replacement: input.narrator },
        ...(input.text.includes("Deniz") ? [{ original: "Deniz", replacement: other }] : []),
      ],
      people: [],
    };
  });
  m.judgeAnonymized.mockResolvedValue({ status: "ok", result: RESULT, input: "doc", refused: false, degraded: false });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/v1/me/history: gates", () => {
  it("needs a session, a limit of 1 to 50 and a cursor it gave out", async () => {
    expect((await list(undefined)).res.status).toBe(401);
    const u = uid();
    for (const q of ["?limit=0", "?limit=51", "?limit=abc"]) expect((await list(u, q)).res.status).toBe(400);
    const bad = [
      "garbage!",
      Buffer.from("not json").toString("base64url"),
      Buffer.from(JSON.stringify(["2026-10-28T12:00:00Z", "v:abc"])).toString("base64url"),
      Buffer.from(JSON.stringify(["2026-10-28T12:00:00.000Z", "x:abc"])).toString("base64url"),
      Buffer.from(JSON.stringify(["2026-10-28T12:00:00.000Z"])).toString("base64url"),
    ];
    for (const c of bad) {
      const { res } = await list(u, `?cursor=${encodeURIComponent(c)}`);
      expect(res.status).toBe(400);
      expect((await body(res)).code).toBe("invalid");
    }
    const ok = await list(u);
    expect(ok.res.status).toBe(200);
    expect(ok.res.headers.get("cache-control")).toBe("no-store");
    expect(ok.data).toEqual({ items: [], next: null });
  });

  it("counts against its own per-account bucket", async () => {
    const u = uid();
    await list(u);
    expect(m.checkUserLimits).toHaveBeenCalledWith(u, "history_list");
    m.checkUserLimits.mockResolvedValueOnce({ ok: false, code: "rate_limited", retryAfterSec: 30 });
    const { res } = await list(u);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("round-trips its cursor", () => {
    const c = encodeCursor({ kind: "case", id: "abc_DEF-123", at: "2026-10-28T12:00:00.000Z" });
    expect(decodeCursor(c)).toEqual({ at: "2026-10-28T12:00:00.000Z", key: "c:abc_DEF-123" });
    expect(decodeCursor(null)).toBeNull();
  });
});

describe("GET /api/v1/me/history: one list", () => {
  it("merges verdicts, jobs, cases started and cases answered, newest first, each with its state", async () => {
    const u = await owner(5);
    const other = await owner(5);

    const ready = await saveVerdict(u);
    const judging = uid("job");
    await jobs.createVerdictJob({ id: judging, kind: "premium", ownerUserId: u });
    const failed = uid("job");
    await jobs.createVerdictJob({ id: failed, kind: "premium", ownerUserId: u });
    await jobs.failVerdictJob(failed, "unavailable", null);
    const oldFailed = uid("job");
    await jobs.createVerdictJob({ id: oldFailed, kind: "premium", ownerUserId: u });
    await jobs.failVerdictJob(oldFailed, "unavailable", null, new Date(Date.now() - 8 * 86_400_000));
    // A round of added context is its own job, shown on its verdict's row only.
    const round = uid("round");
    await jobs.createVerdictJob({ id: round, kind: "premium", ownerUserId: u });
    await sql(
      `INSERT INTO verdict_appeals (id, verdict_id, text, base_id, created_at, updated_at)
       VALUES (?, ?, 'Party A has the receipt now', ?, ?, ?)`,
      [round, ready, ready, new Date().toISOString(), new Date().toISOString()],
    );

    const started = await startCase(u);
    const theirs = await startCase(other);
    await answer(tokenOf(theirs), u);
    await drain();

    const at = (i: number) => new Date(Date.UTC(2026, 9, 20, 10, i)).toISOString();
    await sql("UPDATE verdict_jobs SET created_at = ? WHERE id = ?", [at(1), judging]);
    await sql("UPDATE verdict_jobs SET created_at = ? WHERE id = ?", [at(2), failed]);
    await sql("UPDATE verdict_meta SET created_at = ? WHERE verdict_id = ?", [at(3), ready]);
    await sql("UPDATE cases SET created_at = ? WHERE id = ?", [at(4), started.id]);
    // The answered case sorts by when it was answered, not when it was opened.
    await sql("UPDATE cases SET created_at = ? WHERE id = ?", [at(0), theirs.id]);
    await sql("UPDATE case_sides SET submitted_at = ? WHERE case_id = ? AND party = 'b'", [at(5), theirs.id]);

    const rows = await all(u);
    expect(keys(rows)).toEqual([`c:${theirs.id}`, `c:${started.id}`, `v:${ready}`, `v:${failed}`, `v:${judging}`]);
    const by = (id: string) => rows.find((r) => r.id === id)!;

    expect(by(theirs.id)).toMatchObject({ role: "respondent", party: "b", state: "ready", verdict: "side_a", removable: true });
    expect(by(theirs.id).at).toBe(at(5));
    expect(by(theirs.id).nameMap).toEqual([{ original: "I", replacement: "Party B" }]);
    expect(by(started.id)).toMatchObject({ role: "owner", party: "a", state: "waiting", removable: true, inviteToken: null });
    expect(by(started.id).expiresAt).toBe(started.expiresAt);
    expect(by(started.id).excerpt).toContain("Party A paid the electricity bill");
    expect(by(started.id).nameMap).toEqual([
      { original: "I", replacement: "Party A" },
      { original: "Deniz", replacement: "Party B" },
    ]);
    expect(by(ready)).toMatchObject({ kind: "verdict", state: "rejudging", contextBy: "you", headline: "Party A paid", removable: true });
    expect(by(ready).nameMap).toHaveLength(2);
    expect(by(failed)).toMatchObject({ state: "failed", removable: false, headline: null });
    expect(by(judging)).toMatchObject({ state: "judging", removable: false });

    // The respondent's token opens their own page, signed in.
    const token = by(theirs.id).inviteToken!;
    expect(token).toBe(tokenOf(theirs));
    const page = await http.respondGetHandler(req("GET", `/api/v1/respond/${token}`, { user: u }), token);
    const view = (await body<{ case: CaseView }>(page)).case;
    expect(view.role).toBe("respondent");

    // The other owner sees their case as its owner, never as the respondent.
    const theirRows = await all(other);
    expect(keys(theirRows)).toEqual([`c:${theirs.id}`]);
    expect(theirRows[0]).toMatchObject({ role: "owner", inviteToken: null });
    expect(theirRows[0].nameMap).toEqual([
      { original: "I", replacement: "Party A" },
      { original: "Deniz", replacement: "Party B" },
    ]);
    // Anyone else: nothing.
    expect((await all(uid("stranger"))).length).toBe(0);
  });

  it("pages through rows with the same time across sources: each exactly once, in order", async () => {
    const u = await owner(10);
    const other = await owner(10);
    const same = "2026-10-21T08:00:00.000Z";
    for (let i = 0; i < 4; i++) await sql("UPDATE verdict_meta SET created_at = ? WHERE verdict_id = ?", [same, await saveVerdict(u)]);
    for (let i = 0; i < 3; i++) await sql("UPDATE cases SET created_at = ? WHERE id = ?", [same, (await startCase(u)).id]);
    for (let i = 0; i < 2; i++) {
      const c = await startCase(other);
      await answer(tokenOf(c), u);
      await sql("UPDATE case_sides SET submitted_at = ? WHERE case_id = ? AND party = 'b'", [same, c.id]);
    }
    const job = uid("job");
    await jobs.createVerdictJob({ id: job, kind: "premium", ownerUserId: u });
    await sql("UPDATE verdict_jobs SET created_at = ? WHERE id = ?", [same, job]);
    await drain();

    const whole = keys(await all(u));
    expect(whole).toHaveLength(10);
    for (const limit of [1, 2, 3, 7]) expect(keys(await all(u, limit))).toEqual(whole);
  });

  it("a judging verdict keeps its key and place when it is stored", async () => {
    const u = await owner();
    const id = uid("job");
    await jobs.createVerdictJob({ id, kind: "premium", ownerUserId: u });
    const before = (await all(u))[0];
    expect(before).toMatchObject({ id, state: "judging" });
    await jobs.completeVerdictJob(
      { id, input: "x", result: RESULT, kind: "premium", ownerUserId: u, original: { v: 1, text: "x", nameMap: [] } },
      { ownerToken: null, reservationId: null, settle: "none" },
    );
    const after = await all(u);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id, state: "ready", verdict: "side_a", at: before.at });
  });

  it("removed rows stay listed: without names for whoever removed, with them for the other side", async () => {
    const u = await owner(5);
    const v = await saveVerdict(u);
    await removeVerdict((await getVerdictMeta(v))!, "owner");
    const other = await owner(5);
    const c = await startCase(other);
    const claimSecret = await answer(tokenOf(c), u);
    await drain();
    expect(claimSecret).toBeUndefined();
    const removal = await http.respondRemovalHandler(
      req("POST", `/api/v1/respond/${tokenOf(c)}/removal`, { user: u, body: { confirm: "remove" } }),
      tokenOf(c),
    );
    expect(removal.status).toBe(200);

    const rows = await all(u);
    expect(rows.find((r) => r.id === v)).toMatchObject({ state: "removed", removed: true, headline: null, nameMap: [], verdict: null, removable: false });
    expect(rows.find((r) => r.id === c.id)).toMatchObject({ state: "removed", removed: true, headline: null, nameMap: [], removable: false });
    const theirs = (await all(other))[0];
    expect(theirs).toMatchObject({ state: "removed_by_other", removed: true, headline: "Party A paid", verdict: "side_a", removable: false });
    expect(theirs.nameMap.length).toBeGreaterThan(0);
  });

  it("removable follows the page: not while judging or re-judging", async () => {
    const u = await owner(5);
    const other = await owner(5);
    const c = await startCase(u);
    await answer(tokenOf(c), other);
    const judging = (await all(u))[0];
    expect(judging).toMatchObject({ state: "judging", removable: false });
    await drain();
    expect((await all(u))[0]).toMatchObject({ state: "ready", removable: true, contextAdded: false });
    const appeal = await http.ownerAppealHandler(
      req("POST", `/api/v1/cases/${c.id}/appeals`, { user: u, body: { text: "The receipt shows the payment on April 3rd, plainly." } }),
      c.id,
    );
    expect(appeal.status).toBe(202);
    expect((await all(u))[0]).toMatchObject({ state: "rejudging", contextBy: "you", removable: false, verdict: "side_a" });
    expect((await all(other))[0]).toMatchObject({ role: "respondent", state: "rejudging", contextBy: "other", removable: false });
    await drain();
    expect((await all(u))[0]).toMatchObject({ state: "ready", contextAdded: true, removable: true });
  });

  it("a respondent link that no longer opens is sent as null and can't be removed from the list", async () => {
    const u = await owner();
    const other = await owner();
    const c = await startCase(other);
    await answer(tokenOf(c), u);
    await drain();
    await sql("UPDATE cases SET invite_hash = ? WHERE id = ?", ["0".repeat(64), c.id]);
    expect((await all(u))[0]).toMatchObject({ inviteToken: null, removable: false, state: "ready" });
  });

  it("leaves cases out while cases are switched off", async () => {
    const u = await owner();
    await startCase(u);
    const v = await saveVerdict(u);
    vi.stubEnv("CASES_ENABLED", "0");
    expect(keys(await all(u))).toEqual([`v:${v}`]);
  });
});
