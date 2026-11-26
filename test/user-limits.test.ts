import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-ulimits-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";

const rl = await import("../lib/ratelimit");
const ent = await import("../lib/entitlements");

const { cookieSet } = vi.hoisted(() => ({ cookieSet: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet }) }));

afterEach(() => {
  cookieSet.mockClear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const MIN = 60_000;

describe("MultiWindowLimiter", () => {
  it("enforces every window and records only allowed hits", () => {
    const l = new rl.MultiWindowLimiter([
      { limit: 2, windowMs: 10 * MIN },
      { limit: 3, windowMs: 24 * 60 * MIN },
    ]);
    const t0 = 1_000_000_000;
    expect(l.check("u", t0).ok).toBe(true);
    expect(l.check("u", t0 + MIN).ok).toBe(true);
    const short = l.check("u", t0 + 2 * MIN);
    expect(short).toEqual({ ok: false, code: "rate_limited", retryAfterSec: 8 * 60 });
    // After the short window, the daily window still has room for one.
    expect(l.check("u", t0 + 11 * MIN).ok).toBe(true);
    const daily = l.check("u", t0 + 30 * MIN);
    expect(daily.ok).toBe(false);
    if (!daily.ok && daily.code === "rate_limited") {
      expect(daily.retryAfterSec).toBe(24 * 60 * 60 - 30 * 60);
    }
    // Other keys are independent.
    expect(l.check("v", t0 + 30 * MIN).ok).toBe(true);
  });
});

describe("checkUserLimits (memory)", () => {
  it("premium verdicts: 10 per 10 minutes per account", async () => {
    for (let i = 0; i < 10; i++) expect((await rl.checkUserLimits("acct-1", "premium_verdict")).ok).toBe(true);
    const refused = await rl.checkUserLimits("acct-1", "premium_verdict");
    expect(refused).toMatchObject({ ok: false, code: "rate_limited" });
    expect((await rl.checkUserLimits("acct-2", "premium_verdict")).ok).toBe(true);
  });

  it("buckets are separate: clarify allows 20 per 10 minutes", async () => {
    for (let i = 0; i < 20; i++) expect((await rl.checkUserLimits("acct-3", "clarify")).ok).toBe(true);
    expect((await rl.checkUserLimits("acct-3", "clarify")).ok).toBe(false);
    expect((await rl.checkUserLimits("acct-3", "premium_verdict")).ok).toBe(true);
  });

  it("documents the configured windows", () => {
    expect(rl.USER_LIMITS.premium_verdict.map((w) => [w.limit, w.windowMs])).toEqual([
      [10, 10 * MIN],
      [60, 24 * 60 * MIN],
    ]);
    expect(rl.USER_LIMITS.clarify.map((w) => [w.limit, w.windowMs])).toEqual([
      [20, 10 * MIN],
      [100, 24 * 60 * MIN],
    ]);
  });

  it("clarify stops at 100 a day even when every 10-minute window has room", async () => {
    let now = 2_000_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 20; i++) expect((await rl.checkUserLimits("acct-day", "clarify")).ok).toBe(true);
      now += 11 * MIN;
    }
    const refused = await rl.checkUserLimits("acct-day", "clarify");
    expect(refused).toMatchObject({ ok: false, code: "rate_limited" });
    now += 24 * 60 * MIN;
    expect((await rl.checkUserLimits("acct-day", "clarify")).ok).toBe(true);
  });
});

describe("checkUserLimits (Redis)", () => {
  it("fails closed when Redis is unreachable", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await rl.checkUserLimits("acct-redis", "premium_verdict");
    vi.unstubAllGlobals();
    expect(res).toMatchObject({ ok: false, code: "unavailable" });
  });
});

describe("checkPremiumSiteCap", () => {
  it("reads PREMIUM_DAILY_CAP (default 500, 0 pauses premium)", () => {
    expect(rl.premiumDailyCap({})).toBe(500);
    expect(rl.premiumDailyCap({ PREMIUM_DAILY_CAP: "0" })).toBe(0);
    expect(rl.premiumDailyCap({ PREMIUM_DAILY_CAP: "25" })).toBe(25);
    expect(rl.premiumDailyCap({ PREMIUM_DAILY_CAP: "-1" })).toBe(500);
    expect(rl.premiumDailyCap({ PREMIUM_DAILY_CAP: "abc" })).toBe(500);
    expect(rl.welcomeDailyCap({})).toBe(100);
    expect(rl.welcomeDailyCap({ WELCOME_DAILY_CAP: "3" })).toBe(3);
  });

  it("0 pauses premium until the next UTC day", async () => {
    vi.stubEnv("PREMIUM_DAILY_CAP", "0");
    const now = new Date("2026-10-19T23:00:00Z");
    expect(await rl.checkPremiumSiteCap("cap-user", now)).toEqual({ ok: false, code: "daily_cap", retryAfterSec: 3600 });
  });

  it("counts today's free runs from the database; a refund does not free a slot", async () => {
    vi.stubEnv("PREMIUM_DAILY_CAP", "2");
    for (const u of ["free-a", "free-b"]) await ent.grantWelcomeCredit(u, `claim-${u}`);
    expect((await rl.checkPremiumSiteCap("free-a")).ok).toBe(true);
    const a = await ent.reservePremiumVerdict("free-a");
    const b = await ent.reservePremiumVerdict("free-b");
    if (!a.ok || !b.ok) throw new Error("expected reservations");
    await ent.grantWelcomeCredit("free-c", "claim-free-c");
    expect(await rl.checkPremiumSiteCap("free-c")).toMatchObject({ ok: false, code: "daily_cap" });
    // A failed run still paid for its model calls.
    await ent.refundPremiumVerdict(b.reservation.id);
    expect(await rl.checkPremiumSiteCap("free-c")).toMatchObject({ ok: false, code: "daily_cap" });
  });

  it("never holds back a paid credit or a plan, whatever the cap says", async () => {
    vi.stubEnv("PREMIUM_DAILY_CAP", "0");
    await ent.grantCredits({ userId: "paid-pack", credits: 1, source: "app_store", externalId: "tx-paid-pack" });
    await ent.grantSubscription({
      userId: "paid-plan",
      source: "app_store",
      externalId: "evt-paid-plan",
      originalTransactionId: "otid-paid-plan",
      productId: "monthly",
      periodStart: new Date(Date.now() - 1000).toISOString(),
      periodEnd: new Date(Date.now() + 86_400_000).toISOString(),
      willRenew: true,
    });
    await ent.grantWelcomeCredit("free-paused", "claim-free-paused");
    expect(await rl.checkPremiumSiteCap("paid-pack")).toEqual({ ok: true });
    expect(await rl.checkPremiumSiteCap("paid-plan")).toEqual({ ok: true });
    expect(await rl.checkPremiumSiteCap("free-paused")).toMatchObject({ ok: false, code: "daily_cap" });
  });

  it("fails closed when the count fails", async () => {
    vi.stubEnv("PREMIUM_DAILY_CAP", "5");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(ent, "countWelcomeToday").mockRejectedValueOnce(new Error("db down"));
    expect(await rl.checkPremiumSiteCap("cap-user")).toMatchObject({ ok: false, code: "unavailable" });
  });
});

describe("one free verdict a day per device", () => {
  const web = (cookie?: string) => new Headers(cookie ? { cookie: `theme=dark; verdict.browser=${cookie}` } : {});
  const app = (deviceId?: string) =>
    new Headers({ authorization: "Bearer t", "x-forwarded-for": "198.51.100.1", ...(deviceId ? { "device-id": deviceId } : {}) });
  const BROWSER_A = "A".repeat(22);
  const BROWSER_B = "B".repeat(22);

  async function signedInOn(userId: string, deviceId: string) {
    const { noteSignIn } = await import("../lib/analytics/devices");
    await noteSignIn(userId, new Headers({ "device-id": deviceId, "device-platform": "ios" }));
  }
  const fresh = async (u: string) => ent.grantWelcomeCredit(u, `claim-${u}`);

  it("two accounts on one phone: the second is refused until tomorrow", async () => {
    await fresh("phone-a");
    await fresh("phone-b");
    await signedInOn("phone-a", "device-shared-1");
    await signedInOn("phone-b", "device-shared-1");
    const now = new Date("2026-11-26T10:00:00Z");
    expect(await rl.checkPremiumSiteCap("phone-a", now, app())).toEqual({ ok: true });
    expect(await rl.checkPremiumSiteCap("phone-b", now, app())).toMatchObject({ ok: false, code: "free_device" });
    expect(await rl.checkPremiumSiteCap("phone-a", now, app())).toEqual({ ok: true });
    const next = new Date("2026-11-27T00:00:01Z");
    expect(await rl.checkPremiumSiteCap("phone-b", next, app())).toEqual({ ok: true });
  });

  it("only the device this request comes from is claimed, not every device the account used", async () => {
    await fresh("many-dev");
    await fresh("on-old");
    await fresh("on-new");
    await signedInOn("many-dev", "device-many-old");
    await signedInOn("on-old", "device-many-old");
    await new Promise((r) => setTimeout(r, 5));
    await signedInOn("many-dev", "device-many-new");
    await signedInOn("on-new", "device-many-new");
    const now = new Date("2026-11-26T11:00:00Z");
    // The sent id when it is one of the account's, else its most recent device.
    expect(await rl.checkPremiumSiteCap("many-dev", now, app("device-many-old"))).toEqual({ ok: true });
    expect(await rl.checkPremiumSiteCap("on-old", now, app())).toMatchObject({ ok: false, code: "free_device" });
    expect(await rl.checkPremiumSiteCap("on-new", now, app())).toEqual({ ok: true });
  });

  it("an id the account never signed in with is ignored", async () => {
    await fresh("liar-a");
    await fresh("liar-b");
    await signedInOn("liar-a", "device-liar-real");
    await signedInOn("liar-b", "device-liar-real");
    const now = new Date("2026-11-26T11:30:00Z");
    expect(await rl.checkPremiumSiteCap("liar-a", now, app("device-made-up-1"))).toEqual({ ok: true });
    expect(await rl.checkPremiumSiteCap("liar-b", now, app("device-made-up-2"))).toMatchObject({ ok: false, code: "free_device" });
  });

  it("the website is told apart by a cookie id; a request without one is a new browser and gets one set", async () => {
    for (const u of ["web-a", "web-b", "web-c", "web-d"]) await fresh(u);
    const now = new Date("2026-11-26T12:00:00Z");
    expect(await rl.checkPremiumSiteCap("web-a", now, web(BROWSER_A))).toEqual({ ok: true });
    expect(cookieSet).not.toHaveBeenCalled();
    expect(await rl.checkPremiumSiteCap("web-b", now, web(BROWSER_A))).toMatchObject({ ok: false, code: "free_device" });
    expect(await rl.checkPremiumSiteCap("web-c", now, web(BROWSER_B))).toEqual({ ok: true });
    expect(await rl.checkPremiumSiteCap("web-d", now, web())).toEqual({ ok: true });
    expect(cookieSet).toHaveBeenCalledTimes(1);
    expect(cookieSet.mock.calls[0][0]).toBe("verdict.browser");
    expect(cookieSet.mock.calls[0][1]).toMatch(/^[A-Za-z0-9_-]{22,64}$/);
    expect(cookieSet.mock.calls[0][2]).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(cookieSet.mock.calls[0][2].maxAge).toBeGreaterThan(365 * 24 * 3600);
  });

  it("the address plays no part: two browsers on one address are two browsers", async () => {
    await fresh("addr-a");
    await fresh("addr-b");
    const now = new Date("2026-11-26T12:30:00Z");
    const same = (cookie: string) => new Headers({ cookie: `verdict.browser=${cookie}`, "x-forwarded-for": "203.0.113.50" });
    expect(await rl.checkPremiumSiteCap("addr-a", now, same("C".repeat(22)))).toEqual({ ok: true });
    expect(await rl.checkPremiumSiteCap("addr-b", now, same("D".repeat(22)))).toEqual({ ok: true });
  });

  it("an app account with no recorded device claims nothing and keeps its one welcome credit", async () => {
    await fresh("nodev-a");
    await fresh("nodev-b");
    const now = new Date("2026-11-26T13:00:00Z");
    expect(await rl.checkPremiumSiteCap("nodev-a", now, app())).toEqual({ ok: true });
    expect(await rl.checkPremiumSiteCap("nodev-b", now, app())).toEqual({ ok: true });
  });

  it("paid accounts are never held by a device", async () => {
    await fresh("bought-after");
    await fresh("held-by");
    await signedInOn("bought-after", "device-bought");
    await signedInOn("held-by", "device-bought");
    const now = new Date("2026-11-26T13:30:00Z");
    expect(await rl.checkPremiumSiteCap("held-by", now, app())).toEqual({ ok: true });
    await ent.grantCredits({ userId: "bought-after", credits: 1, source: "app_store", externalId: "tx-bought-after" });
    expect(await rl.checkPremiumSiteCap("bought-after", now, app())).toEqual({ ok: true });
  });

  it("a request that fails before the credit is spent does not keep the device for the day", async () => {
    await fresh("abandon-a");
    await fresh("abandon-b");
    await signedInOn("abandon-a", "device-abandon");
    await signedInOn("abandon-b", "device-abandon");
    const t0 = new Date("2026-11-26T14:00:00Z");
    expect(await rl.checkPremiumSiteCap("abandon-a", t0, app())).toEqual({ ok: true });
    // Still on its way: holds the device for a while.
    expect(await rl.checkPremiumSiteCap("abandon-b", new Date(t0.getTime() + 5 * MIN), app())).toMatchObject({
      ok: false,
      code: "free_device",
    });
    // Never reserved: the other account may go ahead after 15 minutes.
    expect(await rl.checkPremiumSiteCap("abandon-b", new Date(t0.getTime() + 16 * MIN), app())).toEqual({ ok: true });
  });

  it("once the free credit is reserved the device is held for the rest of the day, even if the run fails", async () => {
    await fresh("spent-a");
    await fresh("spent-b");
    await signedInOn("spent-a", "device-spent");
    await signedInOn("spent-b", "device-spent");
    const t0 = new Date("2026-11-26T15:00:00Z");
    expect(await rl.checkPremiumSiteCap("spent-a", t0, app())).toEqual({ ok: true });
    const r = await ent.reservePremiumVerdict("spent-a", { now: t0 });
    if (!r.ok) throw new Error("expected a reservation");
    await ent.refundPremiumVerdict(r.reservation.id);
    expect(await rl.checkPremiumSiteCap("spent-b", new Date(t0.getTime() + 5 * 3600_000), app())).toMatchObject({
      ok: false,
      code: "free_device",
    });
  });

  it("a deleted account does not give its device's day back", async () => {
    await fresh("gone-a");
    await fresh("gone-b");
    await signedInOn("gone-a", "device-gone");
    await signedInOn("gone-b", "device-gone");
    const now = new Date("2026-11-26T16:00:00Z");
    expect(await rl.checkPremiumSiteCap("gone-a", now, app())).toEqual({ ok: true });
    await ent.reservePremiumVerdict("gone-a", { now });
    await ent.deleteUserEntitlements("gone-a");
    expect(await rl.checkPremiumSiteCap("gone-b", new Date(now.getTime() + 3600_000), app())).toMatchObject({
      ok: false,
      code: "free_device",
    });
  });

  it("a claim over several keys is all or none", async () => {
    const now = new Date("2026-11-26T17:00:00Z");
    expect(await ent.claimFreeVerdictDay("aon-p", ["k-aon-2"], now)).toBe(true);
    expect(await ent.claimFreeVerdictDay("aon-q", ["k-aon-1", "k-aon-2"], now)).toBe(false);
    expect(await ent.claimFreeVerdictDay("aon-r", ["k-aon-1"], now)).toBe(true);
  });

  it("without headers (callers that have no request) nothing is claimed", async () => {
    await fresh("nohead");
    expect(await rl.checkPremiumSiteCap("nohead", new Date("2026-11-26T18:00:00Z"))).toEqual({ ok: true });
  });
});
