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
const { ADULT_CUTOFF_SQL, teenSql, ageStateOf, clearAdultDobs, isTeen, submitDob } = await import("../lib/age");
const { underEighteen, underThirteen, yearsBefore } = await import("../lib/age-date");
const { runCleanup } = await import("../lib/cleanup");
const { ensureOriginalsTables } = await import("../lib/originals/db");
const { saveVerdictWithOriginals, plainSaveOutcome } = await import("../lib/originals/save");
const { track } = await import("../lib/analytics/track");
const { noteSignIn } = await import("../lib/analytics/devices");
const exportRoute = await import("../app/api/v1/me/export/route");
const { keptBlock } = await import("../lib/age");
const { welcomeClaim } = await import("../lib/auth");
const { analyticsDb, insertEvents } = await import("../lib/analytics/db");
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
    sql: 'SELECT age_confirmed_at, age_source, age_blocked_at, age_block_final, age_dob, age_dob_at, age_signal, age_signal_at FROM "user" WHERE id = ?',
    args: [userId],
  });
  return rs.rows[0];
}

async function setRow(userId: string, sets: string, args: (string | null)[] = []) {
  const db = await getDb();
  await db.execute({ sql: `UPDATE "user" SET ${sets} WHERE id = ?`, args: [...args, userId] });
}

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

  it("the 13th birthday is judged on the latest date anywhere, so nobody is closed out on the day", async () => {
    const now = new Date();
    expect(ageStateOf({ dob: ago(18), dobAt: "x", confirmedAt: "x" }, now).teen).toBe(false);
    expect(ageStateOf({ dob: ago(18, -1), dobAt: "x", confirmedAt: "x" }, now).teen).toBe(true);

    const a = await createDevSession("dob-13-today@verdict.local");
    expect((await submitDob(a.user.id, ago(13)))?.blocked).toBe(false);
    // The date it is now in UTC+14 is the last one anywhere: turning 13 on it is allowed, a day later is not.
    const ahead = new Date(Date.now() + 14 * 3_600_000);
    const born = (extraDays: number) =>
      new Date(Date.UTC(ahead.getUTCFullYear() - 13, ahead.getUTCMonth(), ahead.getUTCDate() + extraDays)).toISOString().slice(0, 10);
    const b = await createDevSession("dob-13-ahead@verdict.local");
    expect((await submitDob(b.user.id, born(0)))?.blocked).toBe(false);
    const c = await createDevSession("dob-13-next-day@verdict.local");
    expect((await submitDob(c.user.id, born(1)))?.blocked).toBe(true);
  });

  it("counts 1 March as the day after 29 February, in code and in SQL", async () => {
    const leap = new Date("2028-02-29T12:00:00Z");
    expect(yearsBefore(leap, 13)).toBe("2015-02-28");
    expect(underThirteen("2015-03-01", new Date("2028-02-28T00:00:00Z"))).toBe(true);
    expect(underEighteen("2010-03-01", leap)).toBe(true);
    expect(underEighteen("2010-02-28", leap)).toBe(false);
    const db = await getDb();
    const rs = await db.execute(`SELECT ${ADULT_CUTOFF_SQL.replaceAll("'now'", "'2028-02-29'")} AS cutoff`);
    expect(rs.rows[0].cutoff).toBe("2010-02-28");
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
  it("under 18 without a bracket (every shipped build) makes a teen at once and asks for the date", async () => {
    const { token, user } = await createDevSession("signal-teen@verdict.local");
    const res = await postAge(token, { adult: false, source: "platform" });
    expect(await res.json()).toEqual({ confirmed: true, blocked: false, teen: true, needsDob: true });
    expect(await row(user.id)).toMatchObject({ age_signal: "minor", age_source: "platform", age_blocked_at: null });
    // The same signal on every launch changes nothing more.
    expect((await (await postAge(token, { adult: false, source: "platform" })).json()).teen).toBe(true);
    // The date then decides: under 13 closes it for good.
    const dob = await postAge(token, { dob: ago(11) });
    expect((await dob.json()).blocked).toBe(true);
  });

  it("only an explicit under13: true blocks directly", async () => {
    const { token } = await createDevSession("signal-13@verdict.local");
    expect((await (await postAge(token, { adult: false, source: "platform", under13: true })).json()).blocked).toBe(true);
  });

  it("a store under-18 signal makes a teen whatever the date says, and an adult date does not clear it", async () => {
    const { token, user } = await createDevSession("signal-adult-date@verdict.local");
    await postAge(token, { dob: ago(30) });
    expect((await me(token)).age.teen).toBe(false);
    const res = await postAge(token, { adult: false, source: "platform" });
    expect(await res.json()).toEqual({ confirmed: true, blocked: false, teen: true, needsDob: false });
    expect((await row(user.id)).age_signal).toBe("minor");
    // An adult date given after the signal does not clear it either.
    const later = await createDevSession("signal-then-adult-date@verdict.local");
    await postAge(later.token, { adult: false, source: "platform" });
    expect((await (await postAge(later.token, { dob: ago(30) })).json()).teen).toBe(true);
    // Only the store saying adult does.
    expect((await (await postAge(later.token, { adult: true, source: "platform" })).json()).teen).toBe(false);
  });

  it("the SQL teen test follows the same rule", async () => {
    const { token, user } = await createDevSession("signal-sql@verdict.local");
    const isTeenSql = async () => {
      const rs = await (await getDb()).execute({ sql: `SELECT ${teenSql("u")} AS t FROM "user" u WHERE u.id = ?`, args: [user.id] });
      return Number(rs.rows[0].t) === 1;
    };
    await postAge(token, { dob: ago(30) });
    expect(await isTeenSql()).toBe(false);
    await postAge(token, { adult: false, source: "platform" });
    expect(await isTeenSql()).toBe(true);
  });

  it("an under-13 store signal blocks for good even with a date of 13 or more on file", async () => {
    for (const [email, years] of [["signal13-adult@verdict.local", 30], ["signal13-teen@verdict.local", 15]] as const) {
      const { token, user } = await createDevSession(email);
      await postAge(token, { dob: ago(years) });
      const res = await postAge(token, { adult: false, source: "platform", under13: true });
      expect((await res.json()).blocked).toBe(true);
      expect(await row(user.id)).toMatchObject({ age_block_final: "1" });
      expect((await me(token)).age).toMatchObject({ blocked: true, teen: false });
      expect((await postAge(token, { dob: ago(30) })).status).toBe(403);
    }
  });

  it("an adult store signal never overrides a teen date, and a teen date outlasts the store turning adult", async () => {
    const teen = await createDevSession("signal-teen-date@verdict.local");
    await postAge(teen.token, { dob: ago(15) });
    expect((await (await postAge(teen.token, { adult: true, source: "platform" })).json()).teen).toBe(true);
    expect((await me(teen.token)).age.teen).toBe(true);
    const grown = await createDevSession("signal-grown@verdict.local");
    await postAge(grown.token, { adult: false, source: "platform" });
    await postAge(grown.token, { dob: ago(17, 30) });
    await postAge(grown.token, { adult: true, source: "platform" });
    await setRow(grown.user.id, "age_dob = ?", [ago(18)]);
    expect((await me(grown.token)).age.teen).toBe(false);
  });

  it("a later adult signal ends a signal-only teen; a tick never does", async () => {
    const { token } = await createDevSession("signal-flip@verdict.local");
    await postAge(token, { adult: false, source: "platform" });
    expect((await (await postAge(token, { adult: true, source: "checkbox" })).json()).teen).toBe(true);
    expect((await (await postAge(token, { adult: true, source: "platform" })).json()).teen).toBe(false);
  });
});

describe("a minor signal and the 18th birthday", () => {
  const sqlTeen = async (id: string) => {
    const rs = await (await getDb()).execute({ sql: `SELECT ${teenSql("u")} AS t FROM "user" u WHERE u.id = ?`, args: [id] });
    return Number(rs.rows[0].t) === 1;
  };
  const agree = async (token: string, id: string, expected: boolean) => {
    expect((await me(token)).age.teen).toBe(expected);
    expect(await sqlTeen(id)).toBe(expected);
  };
  const turn18 = async (id: string, signalAgo: string) => {
    await setRow(id, "age_dob = ?, age_signal_at = ?", [ago(18, 1), signalAgo]);
  };

  it("one reported while under 18 ends on the birthday, in code and in SQL, and the cleanup clears it", async () => {
    const { token, user } = await createDevSession("bday-before@verdict.local");
    await postAge(token, { dob: ago(17, 10) });
    await postAge(token, { adult: false, source: "platform" });
    await agree(token, user.id, true);
    // Born 18 years and a day ago, signal reported 10 days ago: before the birthday.
    await turn18(user.id, new Date(Date.now() - 10 * 86_400_000).toISOString());
    await agree(token, user.id, false);
    expect(await clearAdultDobs()).toBeGreaterThanOrEqual(1);
    expect(await row(user.id)).toMatchObject({ age_dob: null, age_signal: null, age_signal_at: null });
    await agree(token, user.id, false);
  });

  it("one reported after the birthday keeps the account a teen, and the cleanup leaves it", async () => {
    const { token, user } = await createDevSession("bday-after@verdict.local");
    await postAge(token, { dob: ago(17, 10) });
    await postAge(token, { adult: false, source: "platform" });
    await turn18(user.id, new Date().toISOString());
    await agree(token, user.id, true);
    await clearAdultDobs();
    expect(await row(user.id)).toMatchObject({ age_dob: null, age_signal: "minor" });
    await agree(token, user.id, true);
  });

  it("an adult store signal clears an earlier minor one", async () => {
    const { token, user } = await createDevSession("bday-adult@verdict.local");
    await postAge(token, { adult: false, source: "platform" });
    await postAge(token, { dob: ago(30) });
    await agree(token, user.id, true);
    await postAge(token, { adult: true, source: "platform" });
    await agree(token, user.id, false);
  });

  it("a signal from before the update, with no time, ends with the date", async () => {
    const { token, user } = await createDevSession("bday-legacy@verdict.local");
    await postAge(token, { dob: ago(15) });
    await setRow(user.id, "age_signal = 'minor', age_signal_at = NULL");
    await agree(token, user.id, true);
    await setRow(user.id, "age_dob = ?", [ago(18, 1)]);
    await agree(token, user.id, false);
  });
});

describe("blocks made under the old 18+ rule", () => {
  const legacyBlock = (userId: string) => setRow(userId, "age_blocked_at = ?, age_block_final = NULL", ["2026-11-01T00:00:00.000Z"]);

  it("show the date step, not the refusal, and a 13 to 17 date lifts the block", async () => {
    const { token, user } = await createDevSession("legacy-teen@verdict.local");
    await legacyBlock(user.id);
    expect((await me(token)).age).toEqual({ confirmed: false, blocked: true, teen: false, needsDob: true });
    const res = await postAge(token, { dob: ago(16) });
    expect(await res.json()).toEqual({ confirmed: true, blocked: false, teen: true, needsDob: false });
    expect(await row(user.id)).toMatchObject({ age_blocked_at: null, age_dob: ago(16) });
  });

  it("an adult date lifts it too; under 13 makes it final", async () => {
    const adult = await createDevSession("legacy-adult@verdict.local");
    await legacyBlock(adult.user.id);
    expect((await (await postAge(adult.token, { dob: ago(30) })).json()).blocked).toBe(false);

    const child = await createDevSession("legacy-child@verdict.local");
    await legacyBlock(child.user.id);
    expect(await (await postAge(child.token, { dob: ago(10) })).json()).toEqual({
      confirmed: false,
      blocked: true,
      teen: false,
      needsDob: false,
    });
    const again = await postAge(child.token, { dob: ago(30) });
    expect(again.status).toBe(403);
    expect((await again.json()).code).toBe("age_blocked");
  });

  it("stay refused everywhere else, and a block made now is final from the start", async () => {
    const { token, user } = await createDevSession("legacy-closed@verdict.local");
    await legacyBlock(user.id);
    const res = await verdictRoute.POST(request("POST", "/api/v1/verdict", bearer(token), { argument: "x".repeat(80) }));
    expect(res.status).toBe(403);
    const fresh = await createDevSession("legacy-fresh@verdict.local");
    await postAge(fresh.token, { adult: false, source: "platform", under13: true });
    expect((await me(fresh.token)).age.needsDob).toBe(false);
    expect((await postAge(fresh.token, { dob: ago(16) })).status).toBe(403);
  });

  it("keep their kind across a deletion: an old block can still be lifted at the next sign-up", async () => {
    const { token, user } = await createDevSession("legacy-delete@verdict.local");
    await legacyBlock(user.id);
    expect((await meRoute.DELETE(request("DELETE", "/api/v1/me", bearer(token), { confirm: "delete" }))).status).toBe(200);
    const back = await createDevSession("legacy-delete@verdict.local");
    expect((await me(back.token)).age).toEqual({ confirmed: false, blocked: true, teen: false, needsDob: true });
    expect((await (await postAge(back.token, { dob: ago(15) })).json()).blocked).toBe(false);
  });
});

describe("races and old blocks", () => {
  const legacyBlock = (userId: string) => setRow(userId, "age_blocked_at = ?, age_block_final = NULL", ["2026-11-01T00:00:00.000Z"]);

  it("a date cannot lift a block that became final in the meantime", async () => {
    const { token, user } = await createDevSession("race-final@verdict.local");
    await legacyBlock(user.id);
    const [a, b] = await Promise.all([submitDob(user.id, ago(10)), submitDob(user.id, ago(15))]);
    expect([a?.blocked, b === null || b.blocked]).toEqual([true, true]);
    expect((await me(token)).age.blocked).toBe(true);
    expect((await row(user.id)).age_block_final).toBe("1");
  });

  it("an explicit under-13 signal makes an old block final, so no date lifts it", async () => {
    const { token, user } = await createDevSession("legacy-signal@verdict.local");
    await legacyBlock(user.id);
    const res = await postAge(token, { adult: false, source: "platform", under13: true });
    expect(await res.json()).toEqual({ confirmed: false, blocked: true, teen: false, needsDob: false });
    expect((await postAge(token, { dob: ago(15) })).status).toBe(403);
    // A bracketless signal leaves an old block alone.
    const other = await createDevSession("legacy-signal-plain@verdict.local");
    await legacyBlock(other.user.id);
    expect((await (await postAge(other.token, { adult: false, source: "platform" })).json()).needsDob).toBe(true);
  });

  it("lifting an old block also clears the kept block on that email", async () => {
    const first = await createDevSession("legacy-claim@verdict.local");
    await legacyBlock(first.user.id);
    await meRoute.DELETE(request("DELETE", "/api/v1/me", bearer(first.token), { confirm: "delete" }));
    const claim = welcomeClaim("legacy-claim@verdict.local")!;
    expect(await keptBlock(claim)).toMatchObject({ final: false });

    const second = await createDevSession("legacy-claim@verdict.local");
    expect((await (await postAge(second.token, { dob: ago(15) })).json()).blocked).toBe(false);
    expect(await keptBlock(claim)).toBeNull();
    await meRoute.DELETE(request("DELETE", "/api/v1/me", bearer(second.token), { confirm: "delete" }));
    const third = await createDevSession("legacy-claim@verdict.local");
    expect((await me(third.token)).age).toMatchObject({ blocked: false, needsDob: true });
  });

  it("a date that loses a race leaves the winner's consent and events alone", async () => {
    const { token, user } = await createDevSession("race-dates@verdict.local");
    await postAge(token, { adult: true, source: "checkbox" });
    await consent(token, "on");
    await ensureOriginalsTables();
    await insertEvents([
      { at: Date.now(), userId: user.id, anonId: null, deviceId: null, platform: "web", appVersion: null, osVersion: null, deviceModel: null, country: null, locale: null, name: "app_open", props: null },
    ]);
    await Promise.all([submitDob(user.id, ago(30)), submitDob(user.id, ago(15))]);
    const state = await me(token);
    const consentNow = (await (await consentRoute.GET(request("GET", "/api/v1/me/consent", bearer(token)))).json()).state;
    const eventRows = (await (await analyticsDb()).execute({ sql: "SELECT id FROM events WHERE user_id = ?", args: [user.id] })).rows.length;
    if (state.age.teen) {
      expect([consentNow, eventRows]).toEqual(["off", 0]);
    } else {
      expect([consentNow, eventRows > 0]).toEqual(["on", true]);
    }
  });
});

describe("events of a blocked or teen account and its devices", () => {
  const headers = (device: string) => new Headers({ "device-id": device, "device-platform": "ios" });
  const anonEvent = async (device: string) =>
    insertEvents([
      { at: Date.now(), userId: null, anonId: "anon-1", deviceId: device, platform: "ios", appVersion: "1", osVersion: null, deviceModel: null, country: null, locale: null, name: "app_open", props: null },
    ]);
  const byDevice = async (device: string) =>
    (await (await analyticsDb()).execute({ sql: "SELECT id FROM events WHERE device_id = ? AND user_id IS NULL", args: [device] })).rows.length;

  it("a teen's earlier signed-out events from their device go with the date", async () => {
    const { token, user } = await createDevSession("dev-teen@verdict.local");
    await noteSignIn(user.id, headers("teen-dev-0001"));
    await anonEvent("teen-dev-0001");
    expect(await byDevice("teen-dev-0001")).toBe(1);
    await postAge(token, { dob: ago(15) });
    expect(await byDevice("teen-dev-0001")).toBe(0);
  });

  it("a blocked account is treated like a teen: stored events deleted, no new ones", async () => {
    const { token, user } = await createDevSession("dev-blocked@verdict.local");
    await noteSignIn(user.id, headers("blocked-dev-0001"));
    await track("case_created", { userId: user.id, props: { mode: "one_sided" } });
    await anonEvent("blocked-dev-0001");
    await postAge(token, { dob: ago(10) });
    const mine = async () =>
      (await (await analyticsDb()).execute({ sql: "SELECT id FROM events WHERE user_id = ?", args: [user.id] })).rows.length;
    expect(await mine()).toBe(0);
    expect(await byDevice("blocked-dev-0001")).toBe(0);
    await track("case_created", { userId: user.id, props: { mode: "one_sided" } });
    expect(await mine()).toBe(0);
    const res = await eventsRoute.POST(
      request("POST", "/api/v1/events", {}, {
        context: { platform: "ios", app_version: "2.0.0", anon_id: "0b5a3a3e-7c1f-4d47-8f0e-6a3c1d2e9f00", device_id: "blocked-dev-0001" },
        events: [{ name: "app_open" }],
      }),
    );
    expect(res.status).toBe(204);
    expect(await byDevice("blocked-dev-0001")).toBe(0);
  });
});

describe("the date of birth after the 18th birthday", () => {
  it("is cleared by the daily cleanup, and an adult signal from the store leaves the adult not a teen", async () => {
    const { token, user } = await createDevSession("dob-clear@verdict.local");
    await postAge(token, { adult: false, source: "platform" });
    await postAge(token, { dob: ago(17, 30) });
    await postAge(token, { adult: true, source: "platform" });
    await setRow(user.id, "age_dob = ?", [ago(18)]);
    const counts = await runCleanup();
    expect(counts.adultDobs).toBeGreaterThanOrEqual(1);
    expect(await row(user.id)).toMatchObject({ age_dob: null, age_dob_at: expect.any(String), age_signal: "adult" });
    expect((await me(token)).age).toEqual({ confirmed: true, blocked: false, teen: false, needsDob: false });
    await setRow(user.id, "age_dob = ?", [ago(18, -1)]);
    expect(await clearAdultDobs()).toBe(0);
  });

  it("goes into the data export with the age signal", async () => {
    const { token, user } = await teenAccount("dob-export@verdict.local");
    const res = await exportRoute.GET(request("GET", "/api/v1/me/export", bearer(token)));
    const data = await res.json();
    expect(data.account).toMatchObject({ dateOfBirth: ago(15), dateOfBirthGivenAt: expect.any(String), id: user.id });
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

  it("recording a teen turns off consent and earlier names in one write, and drops stored events", async () => {
    const { token, user } = await createDevSession("def-batch@verdict.local");
    await postAge(token, { adult: true, source: "checkbox" });
    await consent(token, "on");
    await ensureOriginalsTables();
    await saveVerdictWithOriginals({
      id: "earlier-1",
      input: "doc",
      result: { verdict: "side_a" } as never,
      kind: "premium",
      ownerUserId: user.id,
      original: { v: 1, text: "t", clarifications: [], nameMap: [] },
    });
    await insertEvents([
      { at: Date.now(), userId: user.id, anonId: null, deviceId: null, platform: "web", appVersion: null, osVersion: null, deviceModel: null, country: null, locale: null, name: "app_open", props: null },
    ]);
    const db = await getDb();
    const visible = async () => Number((await db.execute("SELECT names_visible FROM verdict_meta WHERE verdict_id = 'earlier-1'")).rows[0].names_visible);
    const eventRows = async () =>
      (await db.execute({ sql: "SELECT id FROM events WHERE user_id = ?", args: [user.id] })).rows.length;
    expect(await visible()).toBe(1);
    expect(await eventRows()).toBeGreaterThan(0);

    await postAge(token, { dob: ago(15) });
    expect(await visible()).toBe(0);
    expect(await eventRows()).toBe(0);
    const state = await (await consentRoute.GET(request("GET", "/api/v1/me/consent", bearer(token)))).json();
    expect(state.state).toBe("off");
    const ledger = await db.execute({ sql: "SELECT wording_key, choice FROM consent_ledger WHERE user_id = ? ORDER BY id", args: [user.id] });
    expect(ledger.rows.map((r) => [r.wording_key, r.choice])).toEqual([
      ["consent.switchDetail", "on"],
      ["age.teenWithdrawn", "off"],
    ]);
  });

  it("the minor signal on every launch changes nothing for a teen: names switched on stay on, the source stays", async () => {
    for (const [email, setup] of [
      ["idem-signal@verdict.local", async (t: string) => { await postAge(t, { adult: false, source: "platform" }); }],
      ["idem-dob@verdict.local", async (t: string) => { await postAge(t, { dob: ago(15) }); }],
    ] as const) {
      const { token, user } = await createDevSession(email);
      await ensureOriginalsTables();
      await saveVerdictWithOriginals({
        id: `idem-${email}`,
        input: "doc",
        result: { verdict: "side_a" } as never,
        kind: "premium",
        ownerUserId: user.id,
        original: { v: 1, text: "t", clarifications: [], nameMap: [] },
      });
      await setup(token);
      const db = await getDb();
      const q = { sql: "SELECT names_visible FROM verdict_meta WHERE verdict_id = ?", args: [`idem-${email}`] };
      expect(Number((await db.execute(q)).rows[0].names_visible)).toBe(0);
      await db.execute({ sql: "UPDATE verdict_meta SET names_visible = 1 WHERE verdict_id = ?", args: [`idem-${email}`] });
      const source = (await row(user.id)).age_source;
      expect((await (await postAge(token, { adult: false, source: "platform" })).json()).teen).toBe(true);
      expect(Number((await db.execute(q)).rows[0].names_visible)).toBe(1);
      expect((await row(user.id)).age_source).toBe(source);
      expect(await row(user.id)).toMatchObject({ age_signal: "minor", age_signal_at: expect.any(String) });
    }
  });

  it("server-side events skip a teen, and so do signed-out events from their device", async () => {
    const teen = await teenAccount("def-track@verdict.local");
    const adult = await createDevSession("def-track-adult@verdict.local");
    await postAge(adult.token, { dob: ago(30) });
    await track("case_created", { userId: teen.user.id, props: { mode: "one_sided" } });
    await track("case_created", { userId: adult.user.id, props: { mode: "one_sided" } });
    const count = async (id: string) =>
      (await (await analyticsDb()).execute({ sql: "SELECT id FROM events WHERE user_id = ? AND name = 'case_created'", args: [id] })).rows.length;
    expect([await count(teen.user.id), await count(adult.user.id)]).toEqual([0, 1]);

    await noteSignIn(teen.user.id, new Headers({ "device-id": "teen-device-0001", "device-platform": "ios" }));
    const signedOut = (device: string) =>
      eventsRoute.POST(
        request(
          "POST",
          "/api/v1/events",
          {},
          {
            context: { platform: "ios", app_version: "2.0.0", anon_id: "0b5a3a3e-7c1f-4d47-8f0e-6a3c1d2e9f00", device_id: device },
            events: [{ name: "sign_in_started", props: { provider: "apple" } }],
          },
        ),
      );
    const byDevice = async (device: string) =>
      (await (await analyticsDb()).execute({ sql: "SELECT id FROM events WHERE device_id = ? AND user_id IS NULL", args: [device] })).rows.length;
    expect((await signedOut("teen-device-0001")).status).toBe(204);
    expect((await signedOut("other-device-0002")).status).toBe(204);
    expect([await byDevice("teen-device-0001"), await byDevice("other-device-0002")]).toEqual([0, 1]);
  });

  it("a teen's verdict saved by the fallback path still reports names off", () => {
    expect(plainSaveOutcome({ teen: true }).display.namesVisible).toBe(false);
    expect(plainSaveOutcome({}).display.namesVisible).toBe(true);
  });

  it("their verdict's names stay off the share page, even when they became a teen after the read", async () => {
    const { user } = await createDevSession("def-names@verdict.local");
    await ensureOriginalsTables();
    const write = async (id: string, teen: boolean) => {
      const { stmts, outcome } = verdictWriteStatements({
        id,
        input: "doc",
        result: { verdict: "side_a" } as never,
        kind: "premium",
        ownerUserId: user.id,
        original: { v: 1, text: "t", clarifications: [], nameMap: [] },
        teen,
      });
      await (await getDb()).batch(stmts, "write");
      const meta = await (await getDb()).execute({ sql: "SELECT names_visible FROM verdict_meta WHERE verdict_id = ?", args: [id] });
      return { column: Number(meta.rows[0].names_visible), reported: outcome.display.namesVisible };
    };
    expect(await write("names-adult", false)).toEqual({ column: 1, reported: true });
    expect(await write("names-teen-flag", true)).toEqual({ column: 0, reported: false });
    // The writer is recorded as a teen after the flag was read as false.
    await postAge((await createDevSession("def-names@verdict.local")).token, { dob: ago(15) });
    expect((await write("names-teen-late", false)).column).toBe(0);
  });
});
