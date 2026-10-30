import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The 18+ check against a real (temporary) database and real sessions:
 * POST /api/v1/me/age, and the gate as the route handlers apply it. Model
 * calls are stubbed to fail, so nothing that gets past the gate reaches the
 * network.
 */

vi.mock("@/lib/claude", async (importOriginal) => {
  const failed = async () => ({ ok: false, blocked: false, error: "stubbed" });
  return { ...(await importOriginal<typeof import("@/lib/claude")>()), claudeJson: failed, claudeSearchJson: failed };
});

const dir = mkdtempSync(path.join(tmpdir(), "verdict-age-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3600";

const { createDevSession, getAuth, sessionCookieHeader, welcomeClaim } = await import("../lib/auth");
const { getDb } = await import("../lib/db");
const { ageRefusal, confirmAdult, keptBlock } = await import("../lib/age");
const { POST: postAgeRoute } = await import("../app/api/v1/me/age/route");
const meRoute = await import("../app/api/v1/me/route");
const verdictRoute = await import("../app/api/v1/verdict/route");
const clarifyRoute = await import("../app/api/v1/clarify/route");
const evidenceRoute = await import("../app/api/v1/evidence/route");
const casesRoute = await import("../app/api/v1/cases/route");
const historyRoute = await import("../app/api/v1/me/history/route");
const myVerdictsRoute = await import("../app/api/v1/me/verdicts/route");
const eventsRoute = await import("../app/api/v1/events/route");
const { config: proxyConfig } = await import("../proxy");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Premium (and with it cases and evidence) is on; the stubbed model never answers.
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const BASE = "http://localhost:3600";
const ARGUMENT = "We argued for a week about whose turn it was to do the dishes after the party.";

type Auth = Record<string, string>;
const bearer = (token: string): Auth => ({ authorization: `Bearer ${token}` });
const cookie = async (token: string, name = "verdict.session_token"): Promise<Auth> => {
  const value = (await sessionCookieHeader(token)).split(";")[0].split("=").slice(1).join("=");
  return { cookie: `${name}=${value}`, origin: BASE, host: "localhost:3600" };
};

const request = (method: string, p: string, auth: Auth = {}, body?: unknown) =>
  new Request(`${BASE}${p}`, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": `k${Math.random().toString(36).slice(2)}`, ...auth },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

const postAge = (token: string, body: unknown) => postAgeRoute(request("POST", "/api/v1/me/age", bearer(token), body));
const me = async (token: string) => (await meRoute.GET(request("GET", "/api/v1/me", bearer(token)))).json();

/** Starting AI work or spending: refused until the account is confirmed. */
const starting: [string, (auth: Auth) => Promise<Response>][] = [
  ["POST /api/v1/verdict", (a) => verdictRoute.POST(request("POST", "/api/v1/verdict", a, { argument: ARGUMENT }))],
  ["POST /api/v1/clarify", (a) => clarifyRoute.POST(request("POST", "/api/v1/clarify", a, { argument: ARGUMENT }))],
  ["POST /api/v1/evidence", (a) => evidenceRoute.POST(request("POST", "/api/v1/evidence", a, { images: [] }))],
  ["POST /api/v1/cases", (a) => casesRoute.POST(request("POST", "/api/v1/cases", a, { text: ARGUMENT, lang: "en" }))],
];

/** Reading and housekeeping: open to an unconfirmed account. */
const reading: [string, (auth: Auth) => Promise<Response>][] = [
  ["GET /api/v1/me/history", (a) => historyRoute.GET(request("GET", "/api/v1/me/history", a))],
  ["GET /api/v1/me/verdicts", (a) => myVerdictsRoute.GET(request("GET", "/api/v1/me/verdicts", a))],
  ["GET /api/v1/cases", (a) => casesRoute.GET(request("GET", "/api/v1/cases", a))],
  ["POST /api/v1/events", (a) => eventsRoute.POST(request("POST", "/api/v1/events", a, { events: [] }))],
];

async function expectRefused(res: Response, code: "age_blocked" | "age_unconfirmed", what: string) {
  expect(res.status, what).toBe(403);
  expect(res.headers.get("cache-control"), what).toBe("no-store");
  expect(await res.json(), what).toEqual({ error: code, code });
}

async function ageRow(userId: string) {
  const db = await getDb();
  const rs = await db.execute({
    sql: 'SELECT age_confirmed_at, age_source, age_blocked_at FROM "user" WHERE id = ?',
    args: [userId],
  });
  return rs.rows[0];
}

const signalLines = () =>
  vi
    .mocked(console.warn)
    .mock.calls.map((c) => String(c[0]))
    .filter((l) => l.startsWith("[signal:age_blocked]"));

describe("POST /api/v1/me/age", () => {
  it("needs a session", async () => {
    const res = await postAgeRoute(request("POST", "/api/v1/me/age", {}, { adult: true, source: "checkbox" }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("signin_required");
  });

  it("refuses anything but the two documented bodies", async () => {
    const { token, user } = await createDevSession("age-invalid@verdict.local");
    for (const body of [
      "not json",
      {},
      { adult: true },
      { adult: "yes", source: "checkbox" },
      { adult: true, source: "parent" },
      { adult: false, source: "checkbox" },
      { adult: false },
      { adult: true, source: "checkbox", extra: 1 },
      [true],
      null,
    ]) {
      const res = await postAge(token, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).code).toBe("invalid");
    }
    expect(await ageRow(user.id)).toMatchObject({ age_confirmed_at: null, age_blocked_at: null });
  });

  it("a new account starts unconfirmed; adult:true confirms it once", async () => {
    const { token, user } = await createDevSession("age-adult@verdict.local");
    expect((await me(token)).age).toEqual({ confirmed: false, blocked: false });

    const res = await postAge(token, { adult: true, source: "checkbox" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ confirmed: true, blocked: false });
    expect((await me(token)).age).toEqual({ confirmed: true, blocked: false });
    const first = await ageRow(user.id);
    expect(first.age_source).toBe("checkbox");

    const again = await postAge(token, { adult: true, source: "platform" });
    expect(await again.json()).toEqual({ confirmed: true, blocked: false });
    const second = await ageRow(user.id);
    expect(second.age_confirmed_at).toBe(first.age_confirmed_at);
    expect(second.age_source).toBe("platform");
  });

  it("adult:false blocks for good and signals once", async () => {
    const { token, user } = await createDevSession("age-minor@verdict.local");
    const res = await postAge(token, { adult: false, source: "platform" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmed: false, blocked: true });
    const blockedAt = (await ageRow(user.id)).age_blocked_at;
    expect(blockedAt).toEqual(expect.any(String));

    // From now on the endpoint itself is closed to the account...
    await expectRefused(await postAge(token, { adult: true, source: "platform" }), "age_blocked", "adult:true");
    await expectRefused(await postAge(token, { adult: false, source: "platform" }), "age_blocked", "adult:false");
    expect(signalLines()).toEqual(["[signal:age_blocked]"]);
    // ...and a confirmation written anyway does not lift the block.
    await confirmAdult(user.id, "platform");
    expect((await ageRow(user.id)).age_blocked_at).toBe(blockedAt);
    expect((await me(token)).age).toEqual({ confirmed: true, blocked: true });
  });

  it("a confirmed account can still be blocked", async () => {
    const { token } = await createDevSession("age-flip@verdict.local");
    await postAge(token, { adult: true, source: "checkbox" });
    const res = await postAge(token, { adult: false, source: "platform" });
    expect(await res.json()).toEqual({ confirmed: true, blocked: true });
  });

  it("refuses a cookie request from another site", async () => {
    const { token } = await createDevSession("age-csrf@verdict.local");
    const res = await postAgeRoute(
      request("POST", "/api/v1/me/age", { ...(await cookie(token)), origin: "https://evil.example" }, { adult: true, source: "checkbox" }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("bad_origin");
  });
});

describe("age gate in the routes", () => {
  it("proxy.ts no longer sees API requests (their bodies are not buffered there)", () => {
    expect(proxyConfig.matcher).toEqual(["/v/:id"]);
  });

  it("leaves signed-out requests to the routes' own sign-in check", async () => {
    for (const [what, call] of starting) expect((await call({})).status, what).not.toBe(403);
  });

  it("an unconfirmed account can read but not start a verdict or case, by bearer or cookie", async () => {
    const { token } = await createDevSession("gate-new@verdict.local");
    for (const auth of [bearer(token), await cookie(token)]) {
      for (const [what, call] of starting) await expectRefused(await call(auth), "age_unconfirmed", what);
      for (const [what, call] of reading) expect((await call(auth)).status, what).not.toBe(403);
    }
    expect((await meRoute.GET(request("GET", "/api/v1/me", bearer(token)))).status).toBe(200);
  });

  it("goes by the session Better Auth resolved, not by the cookie's spelling", async () => {
    const { token } = await createDevSession("gate-spaced@verdict.local");
    const spaced = await cookie(token, "verdict.session_token ");
    expect((await me(token)).user).not.toBeNull();
    const res = await verdictRoute.POST(request("POST", "/api/v1/verdict", spaced, { argument: ARGUMENT }));
    await expectRefused(res, "age_unconfirmed", "spaced cookie");
  });

  it("a confirmed account gets past the gate", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { token } = await createDevSession("gate-adult@verdict.local");
    await postAge(token, { adult: true, source: "checkbox" });
    // Premium is off here, so the verdict stops at the next check.
    const res = await verdictRoute.POST(request("POST", "/api/v1/verdict", bearer(token), { argument: ARGUMENT }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("not_configured");
    for (const [what, call] of reading) expect((await call(bearer(token))).status, what).not.toBe(403);
  });

  it("a blocked account keeps only /me and deletion", async () => {
    const { token } = await createDevSession("gate-minor@verdict.local");
    await postAge(token, { adult: true, source: "checkbox" });
    await postAge(token, { adult: false, source: "platform" });
    for (const auth of [bearer(token), await cookie(token)]) {
      for (const [what, call] of [...starting, ...reading]) await expectRefused(await call(auth), "age_blocked", what);
    }
    expect((await meRoute.GET(request("GET", "/api/v1/me", bearer(token)))).status).toBe(200);
  });

  it("fails closed when the session lookup breaks on a route that needs a confirmed age", async () => {
    const { token } = await createDevSession("gate-down@verdict.local");
    await postAge(token, { adult: true, source: "checkbox" });
    const auth = await getAuth();
    vi.spyOn(auth.api, "getSession").mockRejectedValue(new Error("db down"));
    for (const [what, call] of starting) {
      const res = await call(bearer(token));
      expect(res.status, what).toBe(503);
      expect((await res.json()).code, what).toBe("unavailable");
    }
  });

  it("decides by method and the decoded path", () => {
    const fresh = { confirmed: false, blocked: false };
    const blocked = { confirmed: true, blocked: true };
    for (const p of [
      "/api/verdict",
      "/api/v1/verdict",
      "/api/v1/clarify",
      "/api/v1/evidence",
      "/api/v1/cases",
      "/api/v1/cases/c1/judge",
      "/api/v1/cases/c1/appeals",
      "/api/v1/verdicts/v1/appeals",
      "/api/v1/respond/tok123",
      "/api/v1/respond/tok123/appeals",
      "/api/v1/respond/tok123/evidence",
    ]) {
      expect(ageRefusal("POST", p, fresh), p).toBe("age_unconfirmed");
      expect(ageRefusal("GET", p, fresh), p).toBeNull();
      expect(ageRefusal("POST", p, { confirmed: true, blocked: false }), p).toBeNull();
    }
    expect(ageRefusal("POST", "/api/v1/cases/c1/invite", fresh)).toBeNull();
    expect(ageRefusal("POST", "/api/v1/verdicts/v1/translate", fresh)).toBeNull();
    expect(ageRefusal("GET", "/api/v1/me", blocked)).toBeNull();
    expect(ageRefusal("DELETE", "/api/v1/me", blocked)).toBeNull();
    expect(ageRefusal("POST", "/api/v1/auth/apple/code", blocked)).toBeNull();
    expect(ageRefusal("POST", "/api/v1/me/age", blocked)).toBe("age_blocked");
    expect(ageRefusal("GET", "/api/v1/me/history", blocked)).toBe("age_blocked");
  });

  it("matches a percent-encoded path as the router does", async () => {
    const { token } = await createDevSession("gate-encoded@verdict.local");
    const res = await verdictRoute.POST(request("POST", "/api/v1/%76erdict", bearer(token), { argument: ARGUMENT }));
    await expectRefused(res, "age_unconfirmed", "encoded");
  });
});

describe("deleting a blocked account", () => {
  const del = (token: string) => meRoute.DELETE(request("DELETE", "/api/v1/me", bearer(token), { confirm: "delete" }));
  const verdictCount = async () => Number((await (await getDb()).execute("SELECT count(*) AS n FROM verdicts")).rows[0].n);

  it("keeps the block with the scrambled email, so the email signs up blocked", async () => {
    const before = await verdictCount();
    const first = await createDevSession("again-minor@verdict.local");
    await postAge(first.token, { adult: false, source: "platform" });
    const res = await del(first.token);
    expect(res.status).toBe(200);
    expect(await keptBlock(welcomeClaim("again-minor@verdict.local")!)).toEqual(expect.any(String));

    const second = await createDevSession("again-minor@verdict.local");
    expect(second.user.id).not.toBe(first.user.id);
    expect((await me(second.token)).age).toEqual({ confirmed: false, blocked: true });
    await expectRefused(await postAge(second.token, { adult: true, source: "checkbox" }), "age_blocked", "new account");
    expect(await verdictCount()).toBe(before);
  });

  it("leaves no mark for an account that was not blocked", async () => {
    const adult = await createDevSession("again-adult@verdict.local");
    await postAge(adult.token, { adult: true, source: "checkbox" });
    expect((await del(adult.token)).status).toBe(200);
    expect(await keptBlock(welcomeClaim("again-adult@verdict.local")!)).toBeNull();
    const back = await createDevSession("again-adult@verdict.local");
    expect((await me(back.token)).age).toEqual({ confirmed: false, blocked: false });
  });
});
