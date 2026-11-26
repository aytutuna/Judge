import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The date-of-birth flow and the under-18 defaults, against a real
 * (temporary) database and real sessions.
 */

const dir = mkdtempSync(path.join(tmpdir(), "verdict-dob-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3600";

const { createDevSession } = await import("../lib/auth");
const { getDb } = await import("../lib/db");
const { ageStateOf, isTeen, submitDob } = await import("../lib/age");
const { analyticsDb } = await import("../lib/analytics/db");
const { verdictWriteStatements } = await import("../lib/originals/save");
const { POST: postAgeRoute } = await import("../app/api/v1/me/age/route");
const meRoute = await import("../app/api/v1/me/route");
const verdictRoute = await import("../app/api/v1/verdict/route");
const eventsRoute = await import("../app/api/v1/events/route");
const consentRoute = await import("../app/api/v1/me/consent/route");

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
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const BASE = "http://localhost:3600";
let ip = 0;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const request = (method: string, p: string, auth: Record<string, string>, body?: unknown) =>
  new Request(`${BASE}${p}`, {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": `k${Math.random().toString(36).slice(2)}`,
      "x-forwarded-for": `203.0.113.${++ip}`,
      ...auth,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const postAge = (token: string, body: unknown) => postAgeRoute(request("POST", "/api/v1/me/age", bearer(token), body));
const me = async (token: string) => (await meRoute.GET(request("GET", "/api/v1/me", bearer(token)))).json();

/** The calendar date `years` years and `days` days before today (UTC). */
function ago(years: number, days = 0): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear() - years, n.getUTCMonth(), n.getUTCDate() - days)).toISOString().slice(0, 10);
}

async function row(userId: string) {
  const db = await getDb();
  const rs = await db.execute({
    sql: 'SELECT age_confirmed_at, age_source, age_blocked_at, age_dob, age_dob_at, age_signal FROM "user" WHERE id = ?',
    args: [userId],
  });
  return rs.rows[0];
}

async function setRow(userId: string, sets: string, args: (string | null)[] = []) {
  const db = await getDb();
  await db.execute({ sql: `UPDATE "user" SET ${sets} WHERE id = ?`, args: [...args, userId] });
}

async function teenAccount(email: string) {
  const s = await createDevSession(email);
  await postAge(s.token, { dob: ago(15) });
  return s;
}

describe("POST /api/v1/me/age with a date of birth", () => {
  it("keeps only that an adult gave a date, and takes it once", async () => {
    const { token, user } = await createDevSession("dob-adult@verdict.local");
    expect((await me(token)).age).toEqual({ confirmed: false, blocked: false, teen: false, needsDob: true });
    const res = await postAge(token, { dob: ago(30) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmed: true, blocked: false, teen: false, needsDob: false });
    expect(await row(user.id)).toMatchObject({ age_dob: null, age_source: "dob", age_dob_at: expect.any(String) });

    const again = await postAge(token, { dob: ago(40) });
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("age_set");
    expect(await row(user.id)).toMatchObject({ age_dob: null });
  });

  it("keeps a teen's date, and refuses a second one", async () => {
    const { token, user } = await createDevSession("dob-teen@verdict.local");
    const res = await postAge(token, { dob: ago(15) });
    expect(await res.json()).toEqual({ confirmed: true, blocked: false, teen: true, needsDob: false });
    expect((await row(user.id)).age_dob).toBe(ago(15));
    expect((await postAge(token, { dob: ago(30) })).status).toBe(409);
    expect((await me(token)).age.teen).toBe(true);
  });

  it("closes an account under 13 like the old under-18 closure, and keeps no date", async () => {
    const { token, user } = await createDevSession("dob-child@verdict.local");
    const res = await postAge(token, { dob: ago(12) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmed: false, blocked: true, teen: false, needsDob: false });
    expect(await row(user.id)).toMatchObject({ age_dob: null, age_dob_at: null, age_blocked_at: expect.any(String) });
    const signals = vi.mocked(console.warn).mock.calls.filter((c) => String(c[0]).startsWith("[signal:age_blocked]"));
    expect(signals).toHaveLength(1);

    const after = await postAge(token, { dob: ago(30) });
    expect(after.status).toBe(403);
    expect((await after.json()).code).toBe("age_blocked");
    const verdict = await verdictRoute.POST(request("POST", "/api/v1/verdict", bearer(token), { argument: "x".repeat(80) }));
    expect(verdict.status).toBe(403);
    expect((await me(token)).age.blocked).toBe(true);
  });

  it("refuses dates that are not real, in the future or not a plain YYYY-MM-DD", async () => {
    const { token, user } = await createDevSession("dob-bad@verdict.local");
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    for (const body of [
      { dob: future },
      { dob: "2010-02-30" },
      { dob: "1899-12-31" },
      { dob: "05/01/2010" },
      { dob: "" },
      { dob: 20100501 },
      { dob: ago(30), source: "checkbox" },
    ]) {
      const res = await postAge(token, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await row(user.id)).toMatchObject({ age_dob: null, age_dob_at: null, age_blocked_at: null });
  });

  it("the 13th and 18th birthdays count from that day", async () => {
    const now = new Date();
    const one = (dob: string, id: string) => ageStateOf({ dob, dobAt: "x", confirmedAt: "x" }, now).teen && id;
    expect(one(ago(18), "turns 18 today")).toBe(false);
    expect(one(ago(18, -1), "turns 18 tomorrow")).toBe("turns 18 tomorrow");
    expect(one(ago(17, -300), "17")).toBe("17");

    const a = await createDevSession("dob-13-today@verdict.local");
    expect((await submitDob(a.user.id, ago(13)))?.blocked).toBe(false);
    const b = await createDevSession("dob-13-tomorrow@verdict.local");
    expect((await submitDob(b.user.id, ago(13, -1)))?.blocked).toBe(true);
  });

  it("is an adult again on the 18th birthday, without a write", async () => {
    const { token, user } = await createDevSession("dob-birthday@verdict.local");
    await postAge(token, { dob: ago(17, 30) });
    expect((await me(token)).age.teen).toBe(true);
    expect(await isTeen(user.id)).toBe(true);
    await setRow(user.id, "age_dob = ?", [ago(18)]);
    expect((await me(token)).age.teen).toBe(false);
    expect(await isTeen(user.id)).toBe(false);
    await setRow(user.id, "age_dob = ?", [ago(18, -1)]);
    expect((await me(token)).age.teen).toBe(true);
  });
});

describe("the store's age signal", () => {
  it("under 18 with under13 false makes a teen who may use Judge", async () => {
    const { token, user } = await createDevSession("signal-teen@verdict.local");
    const res = await postAge(token, { adult: false, source: "platform", under13: false });
    expect(await res.json()).toEqual({ confirmed: true, blocked: false, teen: true, needsDob: true });
    expect(await row(user.id)).toMatchObject({ age_signal: "minor", age_source: "platform", age_blocked_at: null });
  });

  it("under13 true, or no bracket at all (older builds), still closes the account", async () => {
    const a = await createDevSession("signal-13@verdict.local");
    expect((await (await postAge(a.token, { adult: false, source: "platform", under13: true })).json()).blocked).toBe(true);
    const b = await createDevSession("signal-nobracket@verdict.local");
    expect((await (await postAge(b.token, { adult: false, source: "platform" })).json()).blocked).toBe(true);
  });

  it("a later adult signal ends it; a tick never does", async () => {
    const { token } = await createDevSession("signal-flip@verdict.local");
    await postAge(token, { adult: false, source: "platform", under13: false });
    const ticked = await postAge(token, { adult: true, source: "checkbox" });
    expect((await ticked.json()).teen).toBe(true);
    const adult = await postAge(token, { adult: true, source: "platform" });
    expect((await adult.json()).teen).toBe(false);
  });

  it("with no date on file the signal decides; a teen date decides over it", async () => {
    const { token } = await createDevSession("signal-dob@verdict.local");
    await postAge(token, { adult: false, source: "platform", under13: false });
    // An adult date keeps no date, so the store's word still counts.
    expect((await (await postAge(token, { dob: ago(30) })).json()).teen).toBe(true);
    const old = await createDevSession("signal-dob-old@verdict.local");
    await postAge(old.token, { dob: ago(18, 1) });
    await postAge(old.token, { adult: false, source: "platform", under13: false });
    expect((await me(old.token)).age.teen).toBe(true);
  });
});

describe("older builds' 18+ tick", () => {
  it("is an adult self-declaration without a date: not locked out, asked for the date later", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { token, user } = await createDevSession("old-tick@verdict.local");
    const res = await postAge(token, { adult: true, source: "checkbox" });
    expect(await res.json()).toEqual({ confirmed: true, blocked: false, teen: false, needsDob: true });
    const verdict = await verdictRoute.POST(request("POST", "/api/v1/verdict", bearer(token), { argument: "x".repeat(80) }));
    expect(verdict.status).toBe(503);
    expect((await verdict.json()).code).toBe("not_configured");

    const dob = await postAge(token, { dob: ago(30) });
    expect(await dob.json()).toEqual({ confirmed: true, blocked: false, teen: false, needsDob: false });
    expect((await row(user.id)).age_source).toBe("dob");
  });

  it("a teen date given after a tick makes the account a teen", async () => {
    const { token } = await createDevSession("old-tick-teen@verdict.local");
    await postAge(token, { adult: true, source: "checkbox" });
    expect((await (await postAge(token, { dob: ago(16) })).json()).teen).toBe(true);
  });
});

describe("what a teen gets by default", () => {
  const events = (token: string) =>
    eventsRoute.POST(
      request("POST", "/api/v1/events", bearer(token), {
        context: { platform: "ios", app_version: "2.0.0", device_id: "DEV-0001-abcd" },
        events: [{ name: "case_started" }],
      }),
    );
  const stored = async (userId: string) =>
    (await (await analyticsDb()).execute({ sql: "SELECT id FROM events WHERE user_id = ? AND name = 'case_started'", args: [userId] })).rows.length;
  const consent = (token: string, choice: "on" | "off") =>
    consentRoute.POST(
      request("POST", "/api/v1/me/consent", bearer(token), {
        choice,
        source: "switch",
        wordingKey: "consent.switchDetail",
        lang: "en",
        platform: "ios",
      }),
    );

  it("usage events are dropped, an adult's are kept", async () => {
    const adult = await createDevSession("def-events-adult@verdict.local");
    await postAge(adult.token, { dob: ago(30) });
    expect((await events(adult.token)).status).toBe(204);
    expect(await stored(adult.user.id)).toBe(1);

    const teen = await teenAccount("def-events-teen@verdict.local");
    expect((await events(teen.token)).status).toBe(204);
    expect(await stored(teen.user.id)).toBe(0);
  });

  it("the training choice cannot be turned on, only off", async () => {
    const teen = await teenAccount("def-consent@verdict.local");
    const on = await consent(teen.token, "on");
    expect(on.status).toBe(403);
    expect((await on.json()).code).toBe("not_for_teens");
    expect((await consent(teen.token, "off")).status).toBe(200);

    const adult = await createDevSession("def-consent-adult@verdict.local");
    await postAge(adult.token, { dob: ago(30) });
    expect((await consent(adult.token, "on")).status).toBe(200);
  });

  it("an earlier training consent is withdrawn when the date shows a teen", async () => {
    const { token } = await createDevSession("def-withdraw@verdict.local");
    await postAge(token, { adult: true, source: "checkbox" });
    expect((await consent(token, "on")).status).toBe(200);
    expect((await (await consentRoute.GET(request("GET", "/api/v1/me/consent", bearer(token)))).json()).state).toBe("on");

    await postAge(token, { dob: ago(16) });
    const state = await (await consentRoute.GET(request("GET", "/api/v1/me/consent", bearer(token)))).json();
    expect(state).toMatchObject({ state: "off", ask: false });
  });

  it("the withdrawal also follows a store signal", async () => {
    const { token } = await createDevSession("def-withdraw-signal@verdict.local");
    await postAge(token, { adult: true, source: "platform" });
    await consent(token, "on");
    await postAge(token, { adult: false, source: "platform", under13: false });
    const state = await (await consentRoute.GET(request("GET", "/api/v1/me/consent", bearer(token)))).json();
    expect(state.state).toBe("off");
  });

  it("their verdict's names stay off the share page", () => {
    const input = {
      id: "v1",
      input: "doc",
      result: { verdict: "side_a", parties: undefined },
      kind: "premium",
      ownerUserId: "u1",
      original: { v: 1, text: "t", clarifications: [], nameMap: [] },
    } as never as Parameters<typeof verdictWriteStatements>[0];
    const namesVisible = (teen: boolean) => {
      const { stmts, outcome } = verdictWriteStatements({ ...input, teen });
      const meta = stmts.find((s) => typeof s !== "string" && s.sql.includes("INSERT INTO verdict_meta"))!;
      return { column: (meta as { args: unknown[] }).args[5], reported: outcome.display.namesVisible };
    };
    expect(namesVisible(false)).toEqual({ column: 1, reported: true });
    expect(namesVisible(true)).toEqual({ column: 0, reported: false });
  });
});
