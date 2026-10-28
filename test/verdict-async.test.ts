import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Async verdicts end to end against a real (temporary) database, the real
 * entitlements, originals and job table, with the model calls and sessions
 * mocked. Background work is captured and run with drain().
 */

const m = vi.hoisted(() => ({
  getViewer: vi.fn(),
  anonymize: vi.fn(),
  judgeExtra: vi.fn(),
  runCruxTrial: vi.fn(),
  runFactCheck: vi.fn(),
  judgePremiumPanel: vi.fn(),
  scheduled: [] as (() => Promise<void>)[],
}));

vi.mock("@/lib/auth", () => ({
  getViewer: m.getViewer,
  isSameOrigin: () => true,
  resolveViewer: async (req: Request) => ({ viewer: (await m.getViewer(req)) ?? null, deadBearer: false }),
  hasDeadBearer: async () => false,
  authConfigured: () => true,
  premiumEnabled: () => true,
}));
vi.mock("@/lib/ratelimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ratelimit")>()),
  checkVerdictLimits: async () => ({ ok: true }),
  checkUserLimits: async () => ({ ok: true }),
  checkPremiumSiteCap: async () => ({ ok: true }),
}));
vi.mock("@/lib/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/claude")>()),
  hasApiKey: () => true,
}));
vi.mock("@/lib/anonymize", () => ({ anonymize: m.anonymize }));
vi.mock("@/lib/judge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/judge")>()),
  judgeExtra: m.judgeExtra,
}));
vi.mock("@/lib/trial", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/trial")>()),
  runCruxTrial: m.runCruxTrial,
}));
vi.mock("@/lib/premium/factcheck", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/premium/factcheck")>()),
  runFactCheck: m.runFactCheck,
}));
vi.mock("@/lib/premium/panel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/premium/panel")>()),
  judgePremiumPanel: m.judgePremiumPanel,
}));
vi.mock("@/lib/background", () => ({
  runInBackground: (_label: string, fn: () => Promise<void>) => {
    m.scheduled.push(fn);
  },
}));

const dir = mkdtempSync(path.join(tmpdir(), "verdict-async-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { POST } = await import("../app/api/verdict/route");
const poll = await import("../app/api/v1/verdicts/[id]/route");
const ent = await import("../lib/entitlements");
const jobs = await import("../lib/verdict-jobs");
const { removeUserData } = await import("../lib/originals/removal");
const { getDb } = await import("../lib/db");
import type { JudgeRunOutput, VerdictResult } from "../lib/types";
import type { VerdictAcceptedResponse } from "../lib/verdict-poll";

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const NAME = "Marcus";
const ARGUMENT = `${NAME} says the Great Wall is visible from space with the naked eye; I say it is not.`;
const ANON = "Party A says the Great Wall is visible from space with the naked eye; Party B says it is not.";
const PANEL_MODELS = ["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

const RUN: JudgeRunOutput = {
  verdict: "side_b",
  dispute_type: "factual",
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
const ok = (data: JudgeRunOutput) => ({ ok: true as const, data });
const QUOTA = { ok: false as const, blocked: false, error: "Claude HTTP 429: rate limited" };
const BLOCKED = { ok: false as const, blocked: true, error: "refused" };

let n = 0;
const uid = () => `user-${++n}-${Math.random().toString(36).slice(2, 7)}`;

function post(body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/verdict", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++n % 250}`, ...headers },
      body: JSON.stringify({ argument: ARGUMENT, lang: "en", ...body }),
    }),
  );
}

function get(id: string, headers: Record<string, string> = {}): Promise<Response> {
  return poll.GET(new Request(`http://localhost/api/v1/verdicts/${id}`, { headers }), { params: Promise.resolve({ id }) });
}

async function drain(): Promise<void> {
  while (m.scheduled.length) await m.scheduled.shift()!();
}

async function row<T = Record<string, unknown>>(sql: string, args: (string | number)[] = []): Promise<T | undefined> {
  const db = await getDb();
  return (await db.execute({ sql, args })).rows[0] as T | undefined;
}

function signedIn(id: string) {
  m.getViewer.mockResolvedValue({ user: { id, email: `${id}@x.y`, name: "Aytu Tuna", image: null }, sessionId: "s", via: "bearer" });
}

async function credits(userId: string): Promise<number> {
  return (await ent.getEntitlement(userId)).credits;
}

let logged: unknown[][] = [];

beforeEach(() => {
  m.scheduled.length = 0;
  logged = [];
  m.getViewer.mockResolvedValue(null);
  m.anonymize.mockResolvedValue({ text: ANON, nameMap: [{ original: NAME, replacement: "Party A" }] });
  m.judgeExtra.mockResolvedValue([]);
  m.runCruxTrial.mockResolvedValue(null);
  m.runFactCheck.mockResolvedValue({ status: "none", claims: [] });
  m.judgePremiumPanel.mockResolvedValue({ runs: [ok(RUN), ok(RUN), ok(RUN)], models: PANEL_MODELS });
  for (const level of ["error", "warn", "info", "log"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
  }
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

/** Nothing the background touched may carry the name: logs and the job row. */
async function expectNoNames(id: string): Promise<void> {
  expect(JSON.stringify(logged)).not.toContain(NAME);
  const job = await row("SELECT * FROM verdict_jobs WHERE id = ?", [id]);
  expect(JSON.stringify(job)).not.toContain(NAME);
}

describe("async verdicts", () => {
  async function user(): Promise<string> {
    const id = uid();
    await ent.grantCredits({ userId: id, credits: 3, source: "admin", externalId: `g:${id}` });
    signedIn(id);
    return id;
  }

  it("202 with Prefer: respond-async and the poll headers; judging until the background run ends", async () => {
    await user();
    const res = await post({}, { prefer: "respond-async, wait=5" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as VerdictAcceptedResponse;
    expect(body).toMatchObject({ status: "judging", pollAfterMs: 2000 });
    expect(body.poll).toBe(`/api/v1/verdicts/${body.id}`);
    expect(res.headers.get("location")).toBe(body.poll);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(res.headers.get("preference-applied")).toBe("respond-async");

    const judging = await get(body.id);
    expect(await judging.json()).toEqual({ id: body.id, status: "judging", pollAfterMs: 2000 });
    expect(await row("SELECT id FROM verdicts WHERE id = ?", [body.id])).toBeUndefined();

    await drain();
    const ready = await (await get(body.id)).json();
    expect(ready).toMatchObject({ id: body.id, status: "ready", result: { verdict: "side_b", tier: "premium" } });
    expect(JSON.stringify(ready)).not.toContain(NAME);
  });

  it('`"async": true` in the body opts in too; without either the route answers 200 synchronously', async () => {
    await user();
    const viaBody = await post({ async: true });
    expect(viaBody.status).toBe(202);
    m.scheduled.length = 0;

    const sync = await post({});
    expect(sync.status).toBe(200);
    const body = await sync.json();
    expect(body.result.verdict).toBe("side_b");
    expect(body.status).toBeUndefined();
    expect(m.scheduled).toHaveLength(0);
    expect(await row("SELECT id FROM verdict_jobs WHERE id = ?", [body.id])).toBeUndefined();
  });

  it("signed out: 401 signin_required and no job", async () => {
    const res = await post({}, { prefer: "respond-async" });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("signin_required");
    expect(m.anonymize).not.toHaveBeenCalled();
    expect(m.scheduled).toHaveLength(0);
  });

  it("a removed verdict answers 410; an unknown id 404", async () => {
    await user();
    const { id } = (await (await post({}, { prefer: "respond-async" })).json()) as VerdictAcceptedResponse;
    await drain();
    const db = await getDb();
    await db.execute({ sql: "UPDATE verdict_meta SET removed_at = ?, removal_reason = 'owner' WHERE verdict_id = ?", args: [new Date().toISOString(), id] });
    expect((await get(id)).status).toBe(410);
    expect((await get("nope123456")).status).toBe(404);
  });
});

describe("premium async verdicts", () => {
  async function premiumUser(creditCount = 2): Promise<string> {
    const id = uid();
    await ent.grantCredits({ userId: id, credits: creditCount, source: "admin", externalId: `g:${id}` });
    signedIn(id);
    return id;
  }

  const premium = (key: string) => post({ tier: "premium" }, { prefer: "respond-async", "idempotency-key": key });

  it("reserves and anonymizes in the request, answers 202, consumes the unit once stored", async () => {
    const user = await premiumUser(2);
    const res = await premium("k-ok-1");
    expect(res.status).toBe(202);
    const body = (await res.json()) as VerdictAcceptedResponse;
    expect(body).toMatchObject({ status: "judging", name_map: [{ original: NAME, replacement: "Party A" }], suggested_display_a: "Aytu" });
    expect(body.owner_token).toBeUndefined();
    expect(body.entitlement?.credits).toBe(1);
    expect(m.judgePremiumPanel).not.toHaveBeenCalled();

    // A retry of the same request joins the verdict being judged.
    const retry = await premium("k-ok-1");
    expect(retry.status).toBe(202);
    expect(await retry.json()).toMatchObject({ id: body.id, status: "judging", replayed: true, name_map: [] });
    expect(m.scheduled).toHaveLength(1);

    await drain();
    expect(m.judgePremiumPanel.mock.calls[0][0]).toBe(ANON);
    expect(await credits(user)).toBe(1);
    expect(await row("SELECT status, verdict_id FROM premium_usage WHERE user_id = ?", [user])).toMatchObject({
      status: "consumed",
      verdict_id: body.id,
    });

    // The owning session gets the share-page state; others do not.
    const mine = await (await get(body.id, { authorization: "Bearer t" })).json();
    expect(mine).toMatchObject({ status: "ready", result: { tier: "premium" } });
    expect(mine.owner?.originals_stored).toBe(true);
    signedIn("someone-else");
    expect((await (await get(body.id, { authorization: "Bearer t" })).json()).owner).toBeUndefined();

    // Once finished, the same key replays the stored verdict (200).
    signedIn(user);
    const replay = await premium("k-ok-1");
    expect(replay.status).toBe(200);
    expect((await replay.json()).id).toBe(body.id);
    await expectNoNames(body.id);
  });

  it("a failed background run marks the job failed and refunds the unit", async () => {
    const user = await premiumUser(2);
    m.judgePremiumPanel.mockResolvedValue({ runs: [QUOTA, QUOTA, QUOTA], models: [] });
    const { id } = (await (await premium("k-fail-1")).json()) as VerdictAcceptedResponse;
    expect(await credits(user)).toBe(1);
    await drain();
    expect(await (await get(id)).json()).toMatchObject({ status: "failed", code: "quota" });
    expect(await credits(user)).toBe(2);
    expect(await row("SELECT status FROM premium_usage WHERE user_id = ?", [user])).toMatchObject({ status: "refunded" });
    await expectNoNames(id);
  });

  it("a refused panel stores the verdict and refunds, as on the synchronous path", async () => {
    const user = await premiumUser(1);
    m.judgePremiumPanel.mockResolvedValue({ runs: [BLOCKED, BLOCKED, BLOCKED], models: [] });
    const { id } = (await (await premium("k-ref-1")).json()) as VerdictAcceptedResponse;
    await drain();
    const body = await (await get(id)).json();
    expect(body.status).toBe("ready");
    expect(body.result.model_refused).toBe(true);
    expect(await credits(user)).toBe(1);
  });

  it("deleting the account while it is judging fails the job; the late run stores nothing", async () => {
    const user = await premiumUser(1);
    const { id } = (await (await premium("k-del-1")).json()) as VerdictAcceptedResponse;
    await removeUserData(user, new Date(), { log: false });
    expect(await row("SELECT status, error_code, owner_user_id FROM verdict_jobs WHERE id = ?", [id])).toMatchObject({
      status: "failed",
      error_code: "unavailable",
      owner_user_id: null,
    });
    await drain();
    expect(await row("SELECT id FROM verdicts WHERE id = ?", [id])).toBeUndefined();
    expect(await row("SELECT verdict_id FROM verdict_meta WHERE verdict_id = ?", [id])).toBeUndefined();
    expect(await row("SELECT verdict_id FROM originals WHERE verdict_id = ?", [id])).toBeUndefined();
    expect(await (await get(id)).json()).toMatchObject({ status: "failed", code: "unavailable" });
  });

  it("anonymization failure refunds at once and answers 503 without a job", async () => {
    const user = await premiumUser(1);
    m.anonymize.mockRejectedValue(new Error("names left"));
    const res = await premium("k-anon-1");
    expect(res.status).toBe(503);
    expect(m.scheduled).toHaveLength(0);
    expect(await credits(user)).toBe(1);
  });
});

describe("sweeper", () => {
  async function age(id: string, minutes: number): Promise<void> {
    const db = await getDb();
    await db.execute({
      sql: "UPDATE verdict_jobs SET created_at = ? WHERE id = ?",
      args: [new Date(Date.now() - minutes * 60_000).toISOString(), id],
    });
  }

  it("fails and refunds a job judging for over 10 minutes; a run finishing later stores nothing", async () => {
    const user = uid();
    await ent.grantCredits({ userId: user, credits: 1, source: "admin", externalId: `g:${user}` });
    signedIn(user);
    const { id } = (await (await post({ tier: "premium" }, { prefer: "respond-async", "idempotency-key": "k-sweep" })).json()) as VerdictAcceptedResponse;
    expect(await credits(user)).toBe(0);

    await age(id, 9);
    expect(await jobs.sweepVerdictJobs()).toBe(0);
    await age(id, 11);
    expect(await jobs.sweepVerdictJobs()).toBe(1);
    expect(await jobs.sweepVerdictJobs()).toBe(0);
    expect(await credits(user)).toBe(1);

    // The process that ran it was not dead after all: its late result is dropped.
    await drain();
    expect(await row("SELECT id FROM verdicts WHERE id = ?", [id])).toBeUndefined();
    expect(await row("SELECT verdict_id FROM verdict_meta WHERE verdict_id = ?", [id])).toBeUndefined();
    expect(await credits(user)).toBe(1);
    expect(await (await get(id)).json()).toMatchObject({ status: "failed", code: "unavailable" });
  });

  it("a poll of a stale job fails it on the spot (crash before the sweep ran)", async () => {
    const user = uid();
    await ent.grantCredits({ userId: user, credits: 1, source: "admin", externalId: `g:${user}` });
    signedIn(user);
    const { id } = (await (await post({}, { prefer: "respond-async" })).json()) as VerdictAcceptedResponse;
    m.scheduled.length = 0; // the process died: the run never happens
    await age(id, 12);
    expect(await (await get(id)).json()).toMatchObject({ id, status: "failed", code: "unavailable" });
    expect(await row("SELECT status FROM verdict_jobs WHERE id = ?", [id])).toMatchObject({ status: "failed" });
  });
});
