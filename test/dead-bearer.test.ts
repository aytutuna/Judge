import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A bearer token that matches no live session (unknown, expired, signed out)
 * gets 401 signin_required instead of being served as signed out. Real auth
 * and database; only the bot check, limits and model calls are mocked.
 */

const m = vi.hoisted(() => ({
  checkVerdictLimits: vi.fn(),
  anonymize: vi.fn(),
  judgeSelfConsistent: vi.fn(),
}));

vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: async () => "ok" }));
vi.mock("@/lib/ratelimit", () => ({
  checkVerdictLimits: m.checkVerdictLimits,
  checkIpLimits: async () => ({ ok: true }),
  checkUserLimits: async () => ({ ok: true }),
  checkTranslateLimits: async () => ({ ok: true }),
}));
vi.mock("@/lib/claude", () => ({ hasApiKey: () => true }));
vi.mock("@/lib/anonymize", () => ({ anonymize: m.anonymize }));
vi.mock("@/lib/judge", () => ({ judgeSelfConsistent: m.judgeSelfConsistent, judgeExtra: async () => [] }));
vi.mock("@/lib/trial", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/trial")>()),
  runCruxTrial: async () => null,
}));

const dir = mkdtempSync(path.join(tmpdir(), "verdict-dead-bearer-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3600";

const auth = await import("../lib/auth");
const { getDb } = await import("../lib/db");
const { POST: postVerdict } = await import("../app/api/v1/verdict/route");
const { GET: getVerdict } = await import("../app/api/v1/verdicts/[id]/route");
const { GET: getMe, DELETE: deleteMe } = await import("../app/api/v1/me/route");
const { mineHandler } = await import("../lib/originals/http");
import type { JudgeRunOutput } from "../lib/types";

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
const ARGUMENT = "Mark says the Great Wall is visible from space with the naked eye; I say it is not.";
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
const SIGN_IN_FIRST = { error: "Sign in first.", code: "signin_required" };

beforeEach(() => {
  m.checkVerdictLimits.mockResolvedValue({ ok: true });
  m.anonymize.mockResolvedValue({
    text: "Party A says the Great Wall is visible from space with the naked eye; Party B says it is not.",
    nameMap: [{ original: "Mark", replacement: "Party A" }],
  });
  m.judgeSelfConsistent.mockResolvedValue([RUN, RUN, RUN].map((data) => ({ ok: true, data })));
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const verdictRequest = (headers: Record<string, string> = {}, body: unknown = { argument: ARGUMENT }) =>
  new Request(`${ORIGIN}/api/v1/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3600", ...headers },
    body: JSON.stringify(body),
  });

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function cookieFor(token: string): Promise<string> {
  return (await auth.sessionCookieHeader(token)).split(";")[0];
}

/** A session that existed but is past its expiry. */
async function expiredToken(email: string): Promise<string> {
  const { token } = await auth.createDevSession(email);
  const db = await getDb();
  await db.execute({
    sql: "UPDATE session SET expiresAt = ? WHERE token = ?",
    args: [new Date(Date.now() - 60_000).toISOString(), token],
  });
  return token;
}

/** A session that was signed out (deleted). */
async function signedOutToken(email: string): Promise<string> {
  const { token } = await auth.createDevSession(email);
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM session WHERE token = ?", args: [token] });
  return token;
}

async function expectSignInFirst(res: Response) {
  expect(res.status).toBe(401);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual(SIGN_IN_FIRST);
}

describe("POST /api/v1/verdict with a bearer token", () => {
  it("an unknown, expired or signed-out token gets 401 before any limit or model work (free and premium)", async () => {
    const dead = [
      "not-a-session",
      "not-a-session.bad-signature",
      await expiredToken("expired@verdict.local"),
      await signedOutToken("gone@verdict.local"),
    ];
    for (const token of dead) {
      await expectSignInFirst(await postVerdict(verdictRequest(bearer(token))));
    }
    await expectSignInFirst(await postVerdict(verdictRequest(bearer("nope"), { argument: ARGUMENT, tier: "premium" })));
    // Even with an invalid body: the token is the first thing checked.
    await expectSignInFirst(await postVerdict(verdictRequest(bearer("nope"), { argument: "" })));
    expect(m.checkVerdictLimits).not.toHaveBeenCalled();
    expect(m.anonymize).not.toHaveBeenCalled();
    expect(m.judgeSelfConsistent).not.toHaveBeenCalled();
  });

  it("a dead token next to a valid cookie is still refused", async () => {
    const { token } = await auth.createDevSession("mixed@verdict.local");
    const res = await postVerdict(verdictRequest({ ...bearer("dead"), cookie: await cookieFor(token), origin: ORIGIN }));
    await expectSignInFirst(res);
  });

  it("a valid token is judged and owns the verdict (raw or signed form)", async () => {
    const { token } = await auth.createDevSession("app@verdict.local");
    const res = await postVerdict(verdictRequest(bearer(token)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.verdict).toBe("side_b");
    expect(body.owner_token).toBeUndefined();

    const signed = (await cookieFor(token)).split("=")[1];
    const again = await postVerdict(verdictRequest(bearer(decodeURIComponent(signed))));
    expect(again.status).toBe(200);
    expect((await again.json()).owner_token).toBeUndefined();
  });
});

describe("POST /api/v1/verdict without a bearer token (website unchanged)", () => {
  it("no Authorization header: judged anonymously with an owner token", async () => {
    const res = await postVerdict(verdictRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).owner_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("a same-origin session cookie owns the verdict", async () => {
    const { token } = await auth.createDevSession("web@verdict.local");
    const res = await postVerdict(verdictRequest({ cookie: await cookieFor(token), origin: ORIGIN }));
    expect(res.status).toBe(200);
    expect((await res.json()).owner_token).toBeUndefined();
  });

  it("an expired or garbage cookie counts as signed out, as before (no 401)", async () => {
    const expired = await expiredToken("oldweb@verdict.local");
    for (const cookie of [await cookieFor(expired), "verdict.session_token=garbage"]) {
      const res = await postVerdict(verdictRequest({ cookie, origin: ORIGIN }));
      expect(res.status).toBe(200);
      expect((await res.json()).owner_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("a non-Bearer Authorization header is ignored", async () => {
    const res = await postVerdict(verdictRequest({ authorization: "Basic dXNlcjpwYXNz" }));
    expect(res.status).toBe(200);
  });
});

describe("other routes with a dead bearer token", () => {
  it("GET /api/v1/verdicts/{id}: 401 for a dead token; share viewers without a header still read it", async () => {
    const res = await postVerdict(verdictRequest());
    const { id } = (await res.json()) as { id: string };
    const read = (headers: Record<string, string> = {}) =>
      getVerdict(new Request(`${ORIGIN}/api/v1/verdicts/${id}`, { headers }), { params: Promise.resolve({ id }) });

    expect((await read()).status).toBe(200);
    await expectSignInFirst(await read(bearer("dead")));
    const { token } = await auth.createDevSession("reader@verdict.local");
    expect((await read(bearer(token))).status).toBe(200);
    expect((await read({ cookie: "verdict.session_token=garbage" })).status).toBe(200);
    // Unknown ids: 404 without a header, 401 with a dead token.
    const unknown = () => ({ params: Promise.resolve({ id: "nosuchid00" }) });
    expect((await getVerdict(new Request(`${ORIGIN}/api/v1/verdicts/nosuchid00`), unknown())).status).toBe(404);
    await expectSignInFirst(
      await getVerdict(new Request(`${ORIGIN}/api/v1/verdicts/nosuchid00`, { headers: bearer("dead") }), unknown()),
    );
  });

  it("GET /api/v1/me: 401 for a dead token, nulls without one, the user with a live one", async () => {
    const me = (headers: Record<string, string> = {}) => getMe(new Request(`${ORIGIN}/api/v1/me`, { headers }));
    await expectSignInFirst(await me(bearer(await expiredToken("meold@verdict.local"))));
    const anon = await me();
    expect(anon.status).toBe(200);
    expect(await anon.json()).toEqual({ user: null, entitlement: null });
    expect(await (await me({ cookie: "verdict.session_token=garbage" })).json()).toEqual({ user: null, entitlement: null });
    const { token } = await auth.createDevSession("melive@verdict.local");
    expect((await (await me(bearer(token))).json()).user.email).toBe("melive@verdict.local");
  });

  it("writer routes (owner token or session): a dead token is 401 even next to a valid owner token", async () => {
    const res = await postVerdict(verdictRequest());
    const { id, owner_token: ownerToken } = (await res.json()) as { id: string; owner_token: string };
    const mine = (headers: Record<string, string>) =>
      mineHandler(new Request(`${ORIGIN}/api/v1/verdicts/${id}/mine`, { headers }), id);
    expect((await mine({ "x-owner-token": ownerToken })).status).toBe(200);
    await expectSignInFirst(await mine({ "x-owner-token": ownerToken, ...bearer("dead") }));
  });

  it("routes that need a session already answer 401 signin_required for a dead token", async () => {
    const res = await deleteMe(
      new Request(`${ORIGIN}/api/v1/me`, {
        method: "DELETE",
        headers: { "content-type": "application/json", ...bearer("dead") },
        body: JSON.stringify({ confirm: "delete" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(await auth.getViewer(new Request(ORIGIN, { headers: bearer("dead") }))).toBeNull();
    expect(await auth.hasDeadBearer(new Request(ORIGIN))).toBe(false);
    expect(await auth.hasDeadBearer(new Request(ORIGIN, { headers: bearer("dead") }))).toBe(true);
  });
});
