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

afterEach(() => {
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
  const web = (ip: string) => new Headers({ "x-forwarded-for": ip });
  const app = (token = "t") => new Headers({ authorization: `Bearer ${token}`, "x-forwarded-for": "198.51.100.1" });

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

  it("one account on two devices is not blocked by itself, and holds both for the day", async () => {
    await fresh("two-dev");
    await fresh("other-on-2");
    await signedInOn("two-dev", "device-two-a");
    await signedInOn("two-dev", "device-two-b");
    await signedInOn("other-on-2", "device-two-b");
    const now = new Date("2026-11-26T11:00:00Z");
    expect(await rl.checkPremiumSiteCap("two-dev", now, app())).toEqual({ ok: true });
    expect(await rl.checkPremiumSiteCap("two-dev", now, app())).toEqual({ ok: true });
    expect(await rl.checkPremiumSiteCap("other-on-2", now, app())).toMatchObject({ ok: false, code: "free_device" });
  });

  it("the website is told apart by the visitor's address", async () => {
    await fresh("web-a");
    await fresh("web-b");
    await fresh("web-c");
    const now = new Date("2026-11-26T12:00:00Z");
    expect(await rl.checkPremiumSiteCap("web-a", now, web("203.0.113.50"))).toEqual({ ok: true });
    expect(await rl.checkPremiumSiteCap("web-b", now, web("203.0.113.50"))).toMatchObject({ ok: false, code: "free_device" });
    expect(await rl.checkPremiumSiteCap("web-c", now, web("203.0.113.51"))).toEqual({ ok: true });
  });

  it("an app request is not counted against its address, and paid accounts are never held", async () => {
    await fresh("addr-a");
    await fresh("addr-b");
    const now = new Date("2026-11-26T13:00:00Z");
    expect(await rl.checkPremiumSiteCap("addr-a", now, app())).toEqual({ ok: true });
    expect(await rl.checkPremiumSiteCap("addr-b", now, app())).toEqual({ ok: true });
    await ent.grantWelcomeCredit("bought-after", "claim-bought-after");
    await signedInOn("bought-after", "device-bought");
    await signedInOn("addr-a", "device-bought");
    await ent.grantCredits({ userId: "bought-after", credits: 1, source: "app_store", externalId: "tx-bought-after" });
    expect(await rl.checkPremiumSiteCap("addr-a", now, app())).toEqual({ ok: true });
    expect(await rl.checkPremiumSiteCap("bought-after", now, app())).toEqual({ ok: true });
  });

  it("a deleted account does not give its device's day back", async () => {
    await fresh("gone-a");
    await fresh("gone-b");
    await signedInOn("gone-a", "device-gone");
    await signedInOn("gone-b", "device-gone");
    const now = new Date("2026-11-26T14:00:00Z");
    expect(await rl.checkPremiumSiteCap("gone-a", now, app())).toEqual({ ok: true });
    await ent.deleteUserEntitlements("gone-a");
    expect(await rl.checkPremiumSiteCap("gone-b", now, app())).toMatchObject({ ok: false, code: "free_device" });
  });

  it("a refused claim leaves nothing behind on the account's other devices", async () => {
    for (const u of ["aon-p", "aon-q", "aon-r"]) await fresh(u);
    await signedInOn("aon-p", "device-aon-2");
    await signedInOn("aon-q", "device-aon-1");
    await signedInOn("aon-q", "device-aon-2");
    await signedInOn("aon-r", "device-aon-1");
    const now = new Date("2026-11-26T16:00:00Z");
    expect(await rl.checkPremiumSiteCap("aon-p", now, app())).toEqual({ ok: true });
    expect(await rl.checkPremiumSiteCap("aon-q", now, app())).toMatchObject({ ok: false, code: "free_device" });
    expect(await rl.checkPremiumSiteCap("aon-r", now, app())).toEqual({ ok: true });
  });

  it("without headers (callers that have no request) nothing is claimed", async () => {
    await fresh("nohead");
    expect(await rl.checkPremiumSiteCap("nohead", new Date("2026-11-26T15:00:00Z"))).toEqual({ ok: true });
  });
});
