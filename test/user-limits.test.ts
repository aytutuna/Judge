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

  it("counts today's started premium runs from the database; a refund does not free a slot", async () => {
    vi.stubEnv("PREMIUM_DAILY_CAP", "2");
    expect((await rl.checkPremiumSiteCap("cap-user")).ok).toBe(true);
    await ent.grantCredits({ userId: "cap-user", credits: 5, source: "admin", externalId: "admin:cap" });
    const a = await ent.reservePremiumVerdict("cap-user");
    const b = await ent.reservePremiumVerdict("cap-user");
    if (!a.ok || !b.ok) throw new Error("expected reservations");
    expect(await rl.checkPremiumSiteCap("cap-user")).toMatchObject({ ok: false, code: "daily_cap" });
    // A refused or failed run still paid for its model calls.
    await ent.refundPremiumVerdict(b.reservation.id);
    expect(await rl.checkPremiumSiteCap("cap-user")).toMatchObject({ ok: false, code: "daily_cap" });
  });

  it("holds welcome-credit-only accounts to WELCOME_DAILY_CAP, not paying ones", async () => {
    vi.stubEnv("PREMIUM_DAILY_CAP", "100");
    vi.stubEnv("WELCOME_DAILY_CAP", "1");
    await ent.grantWelcomeCredit("new-1", "claim-new-1");
    await ent.grantWelcomeCredit("new-2", "claim-new-2");
    await ent.grantCredits({ userId: "paid-1", credits: 1, source: "admin", externalId: "admin:paid-1" });
    expect((await rl.checkPremiumSiteCap("new-2")).ok).toBe(true);
    const run = await ent.reservePremiumVerdict("new-1");
    if (!run.ok) throw new Error("expected a reservation");
    expect(await rl.checkPremiumSiteCap("new-2")).toMatchObject({ ok: false, code: "daily_cap" });
    expect((await rl.checkPremiumSiteCap("paid-1")).ok).toBe(true);
  });

  it("fails closed when the count fails", async () => {
    vi.stubEnv("PREMIUM_DAILY_CAP", "5");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(ent, "countPremiumToday").mockRejectedValueOnce(new Error("db down"));
    expect(await rl.checkPremiumSiteCap("cap-user")).toMatchObject({ ok: false, code: "unavailable" });
  });
});
