import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Added context on one-sided verdicts, end to end against a temporary
 * database and the real entitlements and verdict jobs, with the model
 * calls, sessions and the evidence package mocked. Background judging is
 * captured and run with drain().
 */

const m = vi.hoisted(() => ({
  getViewer: vi.fn(),
  isSameOrigin: vi.fn(),
  anonymizeSubmission: vi.fn(),
  verifyEvidenceTokens: vi.fn(),
  judgeAnonymized: vi.fn(),
  claudeJson: vi.fn(),
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
vi.mock("@/lib/evidence", () => ({
  anonymizeSubmission: m.anonymizeSubmission,
  verifyEvidenceTokens: m.verifyEvidenceTokens,
  handleEvidenceUpload: vi.fn(),
  caseNameKeys: () => (name: string) => [`key:${name.toLowerCase()}`],
  evidenceBlock: (groups: { idPrefix: string; items: { transcript: string }[] }[]) =>
    groups.length
      ? `EVIDENCE:\n${groups.flatMap((g) => g.items.map((it, i) => `[${g.idPrefix}${i + 1}] ${it.transcript}`)).join("\n")}`
      : null,
}));
vi.mock("@/lib/premium/run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/premium/run")>()),
  judgeAnonymized: m.judgeAnonymized,
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

const dir = mkdtempSync(path.join(tmpdir(), "verdict-appeals-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { verdictAppealHandler } = await import("../lib/verdict-appeals/http");
const { appealVerdicts, roundsBlock, splitStoredInput } = await import("../lib/verdict-appeals/service");
const ent = await import("../lib/entitlements");
const { getDb } = await import("../lib/db");
const { plainVerdictStatement, saveVerdictWithOriginals } = await import("../lib/originals/save");
const { getVerdictMeta, listOwnerVerdicts } = await import("../lib/originals/db");
const { operatorRemoveVerdict, removeVerdict } = await import("../lib/originals/removal");
const { removalHandler } = await import("../lib/originals/http");
const { verdictRemoved } = await import("../lib/originals/removed");
const { ensureVerdictJobTables } = await import("../lib/verdict-jobs");
const route = await import("../app/api/v1/verdicts/[id]/route");
import { APPEAL_ONE_SIDED_JUDGE_NOTE } from "../lib/judge";
import type { VerdictAppealView, VerdictResult } from "../lib/types";
import type { VerdictAppealResponse, VerdictOwnerState } from "../lib/verdict-poll";

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
const ACCOUNT = "Party A paid the electricity bill in April and Party B says Party A never did.";
const CONTEXT = "I have the bank receipt from April 3rd, which shows the payment going out.";

let n = 0;
const uid = (p = "user") => `${p}-${++n}-${Math.random().toString(36).slice(2, 7)}`;

function result(overrides: Partial<VerdictResult> = {}): VerdictResult {
  return {
    verdict: "side_b",
    dispute_type: "factual",
    headline: "Party B has the stronger case",
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
    losing_side_best_point: "Party A says it was paid",
    confidence: 3,
    runs: ["side_b", "side_b", "side_a"],
    demo: false,
    lang: "en",
    ...overrides,
  };
}

function okOutcome(r: VerdictResult = result({ verdict: "side_a", confidence: 4, tier: "premium" }), extra = {}) {
  return { status: "ok", result: r, input: "doc", refused: false, degraded: false, ...extra };
}

type Opts = { user?: string; body?: unknown; headers?: Record<string, string> };

function post(id: string, opts: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", ...opts.headers };
  if (opts.user) headers["x-test-user"] = opts.user;
  return verdictAppealHandler(
    new Request(`${ORIGIN}/api/v1/verdicts/${id}/appeals`, {
      method: "POST",
      headers,
      body: JSON.stringify(opts.body ?? { text: CONTEXT }),
    }),
    id,
  );
}

async function get(id: string, opts: { user?: string; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.user) {
    headers["x-test-user"] = opts.user;
    headers.authorization = "Bearer test";
  }
  if (opts.token) headers["x-owner-token"] = opts.token;
  const res = await route.GET(new Request(`${ORIGIN}/api/v1/verdicts/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  } as never);
  return {
    status: res.status,
    body: (await res.json()) as {
      status: string;
      code?: string;
      result: VerdictResult;
      appeals?: VerdictAppealView[];
      owner?: VerdictOwnerState;
    },
  };
}

async function drain(): Promise<void> {
  while (m.scheduled.length) await m.scheduled.shift()!();
}

async function usage(userId: string): Promise<string[]> {
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT status FROM premium_usage WHERE user_id = ? ORDER BY created_at", args: [userId] });
  return rs.rows.map((r) => String(r.status));
}

async function credits(userId: string): Promise<number> {
  return (await ent.getEntitlement(userId)).credits;
}

async function owner(creditCount = 3): Promise<string> {
  const id = uid("owner");
  if (creditCount > 0) await ent.grantCredits({ userId: id, credits: creditCount, source: "admin", externalId: `g:${id}` });
  return id;
}

/** A stored one-sided verdict: the signed-in writer's, or (null) one written signed out. */
async function verdict(ownerUserId: string | null, input = ACCOUNT, stored = result()) {
  const id = uid("v").replace(/[^A-Za-z0-9_-]/g, "");
  const saved = await saveVerdictWithOriginals({
    id,
    input,
    result: stored,
    kind: "free",
    ownerUserId,
    original: { v: 1, text: "As written", nameMap: [] },
  });
  return { id, token: saved.ownerToken };
}

async function storedResult(id: string): Promise<string> {
  const db = await getDb();
  return String((await db.execute({ sql: "SELECT result FROM verdicts WHERE id = ?", args: [id] })).rows[0].result);
}

beforeEach(() => {
  m.scheduled.length = 0;
  vi.stubEnv("EVIDENCE_ENABLED", "");
  vi.stubEnv("PREMIUM_ENABLED", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
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
  m.anonymizeSubmission.mockImplementation(async (input: { text: string; evidence: { kind: string; transcript: string }[] }) => ({
    text: input.text.replace(/\bI\b/g, "Party A"),
    evidence: input.evidence.map((e) => ({ kind: e.kind, transcript: e.transcript.replace(/ME/g, "Party A") })),
    nameMap: [{ original: "I", replacement: "Party A" }],
    people: [],
  }));
  m.verifyEvidenceTokens.mockImplementation((tokens: string[], audience: { userId?: string }) =>
    tokens.every((t) => t === `good:${audience.userId}`)
      ? { ok: true, items: tokens.map(() => ({ kind: "chat", transcript: "21:02 ME: here is the receipt" })) }
      : { ok: false, code: "evidence_invalid" },
  );
  m.judgeAnonymized.mockResolvedValue(okOutcome());
  m.claudeJson.mockResolvedValue({ ok: true, data: { summary: "The receipt settled the payment." } });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/v1/verdicts/{id}/appeals", () => {
  it("the writer adds context: 1 unit, judged in the background, stored as a new verdict beside the first", async () => {
    const o = await owner(3);
    const { id } = await verdict(o);
    const before = await storedResult(id);

    const res = await post(id, { user: o });
    expect(res.status).toBe(202);
    const body = (await res.json()) as VerdictAppealResponse;
    expect(body.appeal).toMatchObject({ status: "judging", baseId: id, text: CONTEXT.replace(/\bI\b/, "Party A") });
    expect(body.poll).toBe(`/api/v1/verdicts/${body.appeal.id}`);
    expect(res.headers.get("location")).toBe(body.poll);
    expect(body.name_map).toEqual([{ original: "I", replacement: "Party A" }]);
    expect(body.entitlement?.credits).toBe(2);
    expect((await get(body.appeal.id)).body).toEqual({ id: body.appeal.id, status: "judging", pollAfterMs: 2000 });
    expect((await get(id, { user: o })).body.owner?.appeal).toEqual({ allowed: false, blockedBy: "busy" });

    await drain();
    const call = m.judgeAnonymized.mock.calls.at(-1)![0];
    expect(call.appeal).toBe(APPEAL_ONE_SIDED_JUDGE_NOTE);
    expect(call.text).toBe(
      `${ACCOUNT}\n\nNEW CONTEXT FROM PARTY A (added after an earlier verdict, which Party A had seen):\nParty A have the bank receipt from April 3rd, which shows the payment going out.`,
    );
    expect(call.context).toBeNull();

    const ready = await get(body.appeal.id);
    expect(ready.body.status).toBe("ready");
    expect(ready.body.result.appeal).toEqual({
      by: "a",
      outcome: "overturned",
      previous_id: id,
      previous_verdict: "side_b",
      previous_confidence: 3,
      confidence_change: 1,
      summary: "The receipt settled the payment.",
    });
    expect(await storedResult(id)).toBe(before);
    expect(await usage(o)).toEqual(["consumed"]);
    expect(await credits(o)).toBe(2);

    const pub = await get(id);
    expect(pub.body.result.verdict).toBe("side_b");
    expect(pub.body.appeals).toEqual([
      { id: body.appeal.id, status: "judged", error: null, outcome: "overturned", baseId: id, createdAt: expect.any(String) },
    ]);
    expect(pub.body.owner).toBeUndefined();
    const own = await get(id, { user: o });
    expect(own.body.appeals![0].text).toContain("bank receipt");
    expect(own.body.owner?.appeal).toEqual({ allowed: true, blockedBy: null });
    // The round's verdict is not a verdict of its own to add context to.
    expect((await get(body.appeal.id, { user: o })).body.owner?.appeal).toBeUndefined();
    expect((await post(body.appeal.id, { user: o })).status).toBe(404);
  });

  it("keeps why on the new verdict and shows it to the summary, where the older verdict has none", async () => {
    const o = await owner(2);
    const { id } = await verdict(o);
    const why = "The receipt shows the payment going out in April.";
    m.judgeAnonymized.mockResolvedValue(okOutcome(result({ verdict: "side_a", confidence: 4, tier: "premium", why })));
    const body = (await (await post(id, { user: o })).json()) as VerdictAppealResponse;
    await drain();
    const user = String(m.claudeJson.mock.calls.at(-1)![0].user);
    expect(user).toContain(`NEW VERDICT: side_a\nHeadline: Party B has the stronger case\nWhy: ${why}\nCrux:`);
    expect(user.split("Why:")).toHaveLength(2);
    expect((await get(body.appeal.id)).body.result.why).toBe(why);
  });

  it("needs a session, from this site", async () => {
    const o = await owner(2);
    const { id } = await verdict(o);
    const signedOut = await post(id);
    expect(signedOut.status).toBe(401);
    expect(((await signedOut.json()) as { code: string }).code).toBe("signin_required");
    const cross = await post(id, { user: o, headers: { "x-test-via": "cookie", "x-test-cross": "1" } });
    expect(cross.status).toBe(403);
    expect(await credits(o)).toBe(2);
  });

  it("is the writer's alone: someone else gets a 404, a verdict written signed out is claimed first", async () => {
    const o = await owner(2);
    const { id } = await verdict(o);
    const stranger = await owner(2);
    expect((await post(id, { user: stranger })).status).toBe(404);
    expect((await get(id, { user: stranger })).body.owner).toBeUndefined();
    expect(await credits(stranger)).toBe(2);

    const { id: anon, token } = await verdict(null);
    expect((await get(anon, { token: token! })).body.owner?.appeal).toEqual({ allowed: false, blockedBy: "signin_required" });
    expect((await get(anon, { token: token!, user: stranger })).body.owner?.appeal).toEqual({
      allowed: false,
      blockedBy: "claim_required",
    });
    expect((await get(anon, { token: token!, user: await owner(0) })).body.owner?.appeal).toEqual({
      allowed: false,
      blockedBy: "no_credits",
    });
    expect((await post(anon, { user: stranger })).status).toBe(404);
    const db = await getDb();
    await db.execute({ sql: "UPDATE verdict_meta SET owner_user_id = ? WHERE verdict_id = ?", args: [stranger, anon] });
    expect((await post(anon, { user: stranger })).status).toBe(202);
  });

  it("is Premium: without credits it is refused before anything is written", async () => {
    const o = await owner(0);
    const { id } = await verdict(o);
    expect((await get(id, { user: o })).body.owner?.appeal).toEqual({ allowed: false, blockedBy: "no_credits" });
    m.anonymizeSubmission.mockClear();
    const res = await post(id, { user: o });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { code: string }).code).toBe("no_credits");
    expect(m.anonymizeSubmission).not.toHaveBeenCalled();
    expect((await get(id)).body.appeals).toEqual([]);

    vi.stubEnv("PREMIUM_ENABLED", "0");
    const off = await post(id, { user: await owner(2) });
    expect(off.status).toBe(503);
  });

  it("takes two rounds, one at a time; the second answers the first round's verdict", async () => {
    const o = await owner(5);
    const { id } = await verdict(o);
    const first = (await (await post(id, { user: o })).json()) as VerdictAppealResponse;
    const busy = await post(id, { user: o, body: { text: "Another detail the judges should see here." } });
    expect(busy.status).toBe(409);
    expect(((await busy.json()) as { code: string }).code).toBe("in_progress");
    expect(await credits(o)).toBe(4);
    await drain();

    m.judgeAnonymized.mockResolvedValueOnce(okOutcome(result({ verdict: "side_a", confidence: 5, tier: "premium" })));
    const second = (await (await post(id, { user: o, body: { text: "Party B also admitted it on the phone later." } })).json()) as VerdictAppealResponse;
    expect(second.appeal.baseId).toBe(first.appeal.id);
    await drain();
    const call = m.judgeAnonymized.mock.calls.at(-1)![0];
    expect(call.text).toContain("CONTEXT ADDED EARLIER BY PARTY A (after an earlier verdict, already judged once):");
    expect(call.text).toContain("NEW CONTEXT FROM PARTY A");
    const latest = await get(second.appeal.id);
    expect(latest.body.result.appeal).toMatchObject({ outcome: "upheld", previous_id: first.appeal.id, confidence_change: 1 });

    expect((await get(id, { user: o })).body.owner?.appeal).toEqual({ allowed: false, blockedBy: "appeal_limit" });
    const third = await post(id, { user: o, body: { text: "And one more thing the judges missed." } });
    expect(third.status).toBe(409);
    expect(((await third.json()) as { code: string }).code).toBe("appeal_limit");
    expect(await usage(o)).toEqual(["consumed", "consumed"]);
  });

  it("refunds a round the judges could not finish, and that round does not count", async () => {
    const o = await owner(3);
    const { id } = await verdict(o);
    m.judgeAnonymized.mockResolvedValueOnce({ status: "failed", code: "unavailable", error: "down" });
    const failed = (await (await post(id, { user: o })).json()) as VerdictAppealResponse;
    await drain();
    expect((await get(failed.appeal.id)).body).toMatchObject({ status: "failed", code: "unavailable" });
    expect((await get(id)).body.appeals![0]).toMatchObject({ status: "failed", error: "unavailable" });
    expect(await credits(o)).toBe(3);

    m.judgeAnonymized.mockResolvedValueOnce(okOutcome(result({ model_refused: true }), { refused: true }));
    const refused = (await (await post(id, { user: o })).json()) as VerdictAppealResponse;
    await drain();
    expect((await get(refused.appeal.id)).body).toMatchObject({ status: "failed", code: "refused" });
    expect(await credits(o)).toBe(3);

    m.anonymizeSubmission.mockRejectedValueOnce(new Error("timeout"));
    expect((await post(id, { user: o })).status).toBe(503);
    expect(await credits(o)).toBe(3);

    m.judgeAnonymized.mockResolvedValueOnce(okOutcome(undefined, { degraded: true }));
    const degraded = (await (await post(id, { user: o })).json()) as VerdictAppealResponse;
    await drain();
    expect((await get(degraded.appeal.id)).body.status).toBe("ready");
    expect(await credits(o)).toBe(3);
    expect(await usage(o)).toEqual(["refunded", "refunded", "refunded", "refunded"]);
    expect((await get(id, { user: o })).body.owner?.appeal).toEqual({ allowed: true, blockedBy: null });
  });

  it("replays an Idempotency-Key without a second charge", async () => {
    const o = await owner(3);
    const { id } = await verdict(o);
    const headers = { "idempotency-key": "k-1" };
    const first = (await (await post(id, { user: o, headers })).json()) as VerdictAppealResponse;
    const again = await post(id, { user: o, headers });
    expect(again.status).toBe(202);
    const replay = (await again.json()) as VerdictAppealResponse;
    expect(replay).toMatchObject({ replayed: true, name_map: [], appeal: { id: first.appeal.id } });
    await drain();
    const later = (await (await post(id, { user: o, headers })).json()) as VerdictAppealResponse;
    expect(later.appeal).toMatchObject({ id: first.appeal.id, status: "judged" });
    expect(await usage(o)).toEqual(["consumed"]);
    expect((await post(id, { user: o, headers: { "idempotency-key": "bad key!" } })).status).toBe(400);
  });

  it("replays a degraded round's key instead of starting another round", async () => {
    const o = await owner(3);
    const { id } = await verdict(o);
    const headers = { "idempotency-key": "k-degraded" };
    m.judgeAnonymized.mockResolvedValueOnce(okOutcome(undefined, { degraded: true }));
    const first = (await (await post(id, { user: o, headers })).json()) as VerdictAppealResponse;
    await drain();
    const again = (await (await post(id, { user: o, headers })).json()) as VerdictAppealResponse;
    expect(again).toMatchObject({ replayed: true, appeal: { id: first.appeal.id, status: "judged" } });
    expect(m.scheduled).toHaveLength(0);
    expect(await usage(o)).toEqual(["refunded"]);
    expect(await credits(o)).toBe(3);
  });

  it("takes one screenshot as evidence and shows it to the judges as new evidence", async () => {
    const o = await owner(3);
    const { id } = await verdict(
      o,
      `${ACCOUNT}\n\nEVIDENCE (machine transcripts of images the person asking attached; they show only what was on screen):\n[E1 · Chat]\n  hi`,
      result({ evidence_used: { a: 1, b: 0 } }),
    );
    const bad = await post(id, { user: o, body: { text: CONTEXT, evidence: ["forged"] } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe("evidence_invalid");
    const many = await post(id, { user: o, body: { text: CONTEXT, evidence: [`good:${o}`, `good:${o}`] } });
    expect(((await many.json()) as { code: string }).code).toBe("too_many_files");
    expect(await credits(o)).toBe(3);

    const res = await post(id, { user: o, body: { text: CONTEXT, evidence: [`good:${o}`] } });
    expect(res.status).toBe(202);
    expect(m.anonymizeSubmission.mock.calls.at(-1)![0]).toMatchObject({
      narrator: "Party A",
      evidence: [{ kind: "chat", transcript: "21:02 ME: here is the receipt" }],
    });
    await drain();
    const call = m.judgeAnonymized.mock.calls.at(-1)![0];
    expect(call.text.startsWith(`${ACCOUNT}\n\nNEW CONTEXT`)).toBe(true);
    expect(call.context).toContain("[E1 · Chat]");
    expect(call.context).toContain("[E-new1] 21:02 Party A: here is the receipt");
    expect(call.evidence).toBe(true);
    const db = await getDb();
    const appealId = String((await db.execute({ sql: "SELECT id FROM verdict_appeals WHERE verdict_id = ?", args: [id] })).rows[0].id);
    expect((await get(appealId)).body.result.evidence_used).toEqual({ a: 2, b: 0 });
  });
});

describe("rounds and removal", () => {
  it("removing the first verdict closes its rounds' verdicts too; the list shows the current ruling once", async () => {
    const o = await owner(3);
    const { id } = await verdict(o);
    const first = (await (await post(id, { user: o })).json()) as VerdictAppealResponse;
    await drain();
    const listed = await listOwnerVerdicts(o, 10, null);
    expect(listed.map((v) => v.id)).toEqual([id]);
    expect(listed[0].result?.appeal?.outcome).toBe("overturned");

    await removeVerdict((await getVerdictMeta(id))!, "owner");
    expect((await get(first.appeal.id)).status).toBe(410);
    expect((await post(id, { user: o })).status).toBe(410);
  });

  it("a round's verdict is closed when the first one is removed while it is being judged", async () => {
    const o = await owner(3);
    const { id } = await verdict(o);
    const first = (await (await post(id, { user: o })).json()) as VerdictAppealResponse;
    await removeVerdict((await getVerdictMeta(id))!, "owner");
    await drain();
    expect((await get(first.appeal.id)).status).toBe(410);
  });

  it("a round's verdict follows the first one: its names, its removal, never its own", async () => {
    const o = await owner(3);
    const { id } = await verdict(o);
    m.anonymizeSubmission.mockImplementationOnce(async () => ({
      text: "Party B saw the receipt.",
      evidence: [],
      nameMap: [{ original: "Alice", replacement: "Party B" }],
      people: [],
    }));
    const first = (await (await post(id, { user: o, body: { text: "Alice saw the receipt." } })).json()) as VerdictAppealResponse;
    await drain();
    const round = first.appeal.id;
    const db = await getDb();
    await db.execute({ sql: "UPDATE verdict_meta SET names_visible = 0 WHERE verdict_id = ?", args: [id] });
    const pub = await route.GET(new Request(`${ORIGIN}/api/v1/verdicts/${round}`), { params: Promise.resolve({ id: round }) } as never);
    expect(((await pub.json()) as { display: unknown }).display).toBeNull();

    const removal = await removalHandler(
      new Request(`${ORIGIN}/api/v1/verdicts/${round}/removal`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user": o, authorization: "Bearer test" },
        body: JSON.stringify({ confirm: "remove" }),
      }),
      round,
    );
    expect(removal.status).toBe(404);
    expect((await get(round)).status).toBe(200);

    // Removed on its own (by an operator): no longer the current ruling anywhere.
    await operatorRemoveVerdict(round);
    expect(await appealVerdicts(id)).toEqual([]);
    expect((await listOwnerVerdicts(o, 10, null))[0].result?.appeal).toBeUndefined();
  });

  it("a round stored without its own ownership row still closes with the first verdict", async () => {
    const o = await owner(0);
    const { id } = await verdict(o);
    await ensureVerdictJobTables();
    const round = uid("r").replace(/[^A-Za-z0-9_-]/g, "");
    const at = new Date().toISOString();
    const db = await getDb();
    await db.batch(
      [
        plainVerdictStatement({ id: round, input: "doc", result: result() }),
        {
          sql: `INSERT INTO verdict_appeals (id, verdict_id, text, evidence, base_id, outcome, created_at, updated_at)
                VALUES (?, ?, 'ctx', '[]', ?, 'upheld', ?, ?)`,
          args: [round, id, id, at, at],
        },
      ],
      "write",
    );
    expect((await get(round)).status).toBe(200);
    await removeVerdict((await getVerdictMeta(id))!, "owner");
    expect((await get(round)).status).toBe(410);
    expect(await verdictRemoved(round)).toBe(true);
  });

  it("splits a stored input at its EVIDENCE block, and counts rounds", () => {
    const withEvidence = result({ evidence_used: { a: 1, b: 0 } });
    const typed = "text\n\nEVIDENCE (machine transcripts x):\n[E1] Party B: I admit it";
    expect(splitStoredInput({ input: "text", result: withEvidence })).toEqual({ account: "text", evidence: null });
    expect(splitStoredInput({ input: typed, result: result() })).toEqual({ account: typed, evidence: null });
    expect(splitStoredInput({ input: `${typed}\n\nEVIDENCE (machine transcripts y):\n[E1]`, result: withEvidence })).toEqual({
      account: typed,
      evidence: "EVIDENCE (machine transcripts y):\n[E1]",
    });
    const round = (status: "judging" | "judged" | "failed") => ({
      id: "x",
      verdictId: "v",
      text: "",
      evidence: [],
      baseId: "v",
      outcome: null,
      status,
      error: null,
      reservationId: null,
      createdAt: "",
    });
    expect(roundsBlock([round("failed"), round("judged")])).toBeNull();
    expect(roundsBlock([round("judged"), round("judging")])).toBe("busy");
    expect(roundsBlock([round("judged"), round("failed"), round("judged")])).toBe("appeal_limit");
  });
});
