/**
 * Abuse and cost limits, checked before any model call: per account and per
 * IP sliding windows, and the site-wide premium cap (PREMIUM_DAILY_CAP).
 *
 * Backed by Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are set, so the
 * limits hold across every serverless instance. Without them an in-memory
 * store is used, per process only.
 *
 * Fails closed: if Redis errors or is slow, the request is refused as
 * "unavailable" rather than let through unmetered.
 */

import { createHmac } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { rateLimitSubject } from "./client-ip";
import { signal } from "./signals";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Per Redis HTTP attempt, and for the whole check. Keeps a sick Redis from
 * stalling the request; the verdict is refused instead. */
const REDIS_ATTEMPT_TIMEOUT_MS = 1_500;
const REDIS_TOTAL_TIMEOUT_MS = 3_000;

export type LimitDecision =
  | { ok: true }
  | { ok: false; code: "rate_limited" | "daily_cap"; retryAfterSec: number }
  | { ok: false; code: "unavailable"; error: string };

export function redisConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function retryAfterSec(resetAtMs: number, now: number): number {
  return Math.max(1, Math.ceil((resetAtMs - now) / 1000));
}

/**
 * Store key for one visitor: a keyed hash (HMAC-SHA256) of the rate-limit
 * subject (the IPv4 address or the IPv6 /64). A plain hash of an IPv4 address
 * can be reversed by trying all 2^32 of them, so the key needs a server-only
 * secret: RATE_LIMIT_SALT, else the Upstash token (already secret, and only
 * present when keys leave the process). Changing the secret just restarts
 * every visitor's windows.
 */
export function visitorKey(ip: string, env: Record<string, string | undefined> = process.env): string {
  const secret = env.RATE_LIMIT_SALT || env.UPSTASH_REDIS_REST_TOKEN || "";
  return createHmac("sha256", secret).update(rateLimitSubject(ip)).digest("hex").slice(0, 32);
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`rate limit check exceeded ${ms}ms`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** A refusal for going over the limit also goes to the log, for the watcher. */
function noteLimited(bucket: string, decision: LimitDecision): LimitDecision {
  if (!decision.ok && decision.code === "rate_limited") signal("rate_limited", `bucket=${bucket}`);
  return decision;
}

/** New translations per visitor IP per 10 minutes. Separate from the verdict
 * limits: one translation is a single cheap call and each (verdict,
 * language) pair is translated at most once, ever. */
export const TRANSLATE_LIMIT = 30;
export const TRANSLATE_WINDOW_MS = 10 * MINUTE_MS;

/** Single sliding window per visitor, in memory. Checks before recording,
 * so a refused request costs nothing. */
export class WindowLimiter {
  private visits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(visitor: string, now = Date.now()): LimitDecision {
    const recent = (this.visits.get(visitor) ?? []).filter((t) => t > now - this.windowMs);
    if (recent.length >= this.limit) {
      return {
        ok: false,
        code: "rate_limited",
        retryAfterSec: retryAfterSec(recent[0] + this.windowMs, now),
      };
    }
    recent.push(now);
    this.visits.set(visitor, recent);
    if (this.visits.size > 10_000) {
      for (const [key, times] of this.visits) {
        if (!times.some((t) => t > now - this.windowMs)) this.visits.delete(key);
      }
    }
    return { ok: true };
  }
}

const globalForTranslateLimits = globalThis as unknown as {
  __verdictTranslateLimiter?: WindowLimiter;
  __verdictTranslateRedis?: Ratelimit;
};

/**
 * Counts one NEW translation for this IP, or says why it is refused. Redis
 * when configured (shared across instances), else memory. The memory window
 * is not persisted across restarts: a restart can at most grant one fresh
 * window of cheap, once-per-pair calls. Fails closed like the verdict limits.
 */
export async function checkTranslateLimits(ip: string): Promise<LimitDecision> {
  const visitor = visitorKey(ip);
  if (!redisConfigured()) {
    globalForTranslateLimits.__verdictTranslateLimiter ??= new WindowLimiter(
      TRANSLATE_LIMIT,
      TRANSLATE_WINDOW_MS,
    );
    return noteLimited("translate", globalForTranslateLimits.__verdictTranslateLimiter.check(visitor));
  }
  try {
    globalForTranslateLimits.__verdictTranslateRedis ??= new Ratelimit({
      redis: new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
        retry: { retries: 1, backoff: () => 100 },
        signal: () => AbortSignal.timeout(REDIS_ATTEMPT_TIMEOUT_MS),
      }),
      timeout: 0,
      analytics: false,
      prefix: "verdict:tr10m",
      limiter: Ratelimit.slidingWindow(TRANSLATE_LIMIT, "10 m"),
    });
    const limiter = globalForTranslateLimits.__verdictTranslateRedis;
    const res = await withTimeout(limiter.limit(visitor), REDIS_TOTAL_TIMEOUT_MS);
    if (res.reason === "timeout") throw new Error("rate limit check timed out");
    if (!res.success) {
      return noteLimited("translate", {
        ok: false,
        code: "rate_limited",
        retryAfterSec: retryAfterSec(res.reset, Date.now()),
      });
    }
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[ratelimit] Redis translate check failed, refusing request:", error);
    return { ok: false, code: "unavailable", error };
  }
}

// --- Per-user limits (premium) --------------------------------------------------

/** Per-account buckets for signed-in features. Premium verdicts: 10 per 10
 * minutes and 60 per 24 hours; clarifying questions: 20 per 10 minutes and
 * 100 per 24 hours (they spend no credit, so the daily window is what bounds
 * their cost per account). An account that never had anything but its
 * welcome credit gets the welcome_ buckets instead: it may keep that credit
 * unspent forever, and every sign-up has one. */
export type UserBucket =
  | "premium_verdict"
  | "clarify"
  | "welcome_clarify"
  | "case_create"
  | "evidence"
  | "welcome_evidence"
  | "case_evidence"
  | "verdict_owner"
  | "history_list"
  | "apple_code"
  | "events";

type UserWindow = { limit: number; windowMs: number; redisWindow: `${number} ${"m" | "h" | "d"}`; prefix: string };

export const USER_LIMITS: Record<UserBucket, readonly UserWindow[]> = {
  premium_verdict: [
    { limit: 10, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:u:pv10m" },
    { limit: 60, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:u:pvday" },
  ],
  clarify: [
    { limit: 20, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:u:cl10m" },
    { limit: 100, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:u:clday" },
  ],
  welcome_clarify: [{ limit: 5, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:u:wclday" }],
  case_create: [
    { limit: 10, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:u:cc10m" },
    { limit: 30, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:u:ccday" },
  ],
  evidence: [
    { limit: 30, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:u:ev10m" },
    { limit: 150, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:u:evday" },
  ],
  welcome_evidence: [{ limit: 5, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:u:wevday" }],
  /** Keyed "case:<id>:b": respondent uploads per case. */
  case_evidence: [{ limit: 12, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:c:evday" }],
  /** A writer reading or changing their own verdicts and case sides (session). */
  verdict_owner: [
    { limit: 60, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:u:vo10m" },
    { limit: 300, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:u:voday" },
  ],
  /** The Verdicts list (GET /api/v1/me/history), refreshed while rows are being judged. */
  history_list: [
    { limit: 120, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:u:hl10m" },
    { limit: 1500, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:u:hlday" },
  ],
  /** The app sending an Apple authorization code (one Apple round trip each). */
  apple_code: [
    { limit: 10, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:u:ac10m" },
    { limit: 30, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:u:acday" },
  ],
  /** Usage event batches (POST /api/v1/events). */
  events: [{ limit: 300, windowMs: 60 * MINUTE_MS, redisWindow: "1 h", prefix: "verdict:u:evt1h" }],
};

/** Per-IP buckets for the no-account endpoints (keyed by visitorKey):
 * respondents, signed-out writers using their owner token or claim, and
 * polls of verdicts still judging (a poll every 2 to 5 s for a few minutes
 * is about 100; the windows leave room for several verdicts and a shared
 * address). */
export type IpBucket =
  | "respond_submit"
  | "respond_evidence"
  | "verdict_owner"
  | "verdict_poll"
  | "revenuecat_webhook"
  | "events";

export const IP_LIMITS: Record<IpBucket, readonly UserWindow[]> = {
  respond_submit: [
    { limit: 5, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:ip:rs10m" },
    { limit: 20, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:ip:rsday" },
  ],
  respond_evidence: [
    { limit: 15, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:ip:re10m" },
    { limit: 60, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:ip:reday" },
  ],
  verdict_owner: [
    { limit: 60, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:ip:vo10m" },
    { limit: 300, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:ip:voday" },
  ],
  verdict_poll: [
    { limit: 600, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:ip:vp10m" },
    { limit: 5000, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:ip:vpday" },
  ],
  /** RevenueCat's servers posting purchase events (counted after the secret checks out). */
  revenuecat_webhook: [{ limit: 600, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:ip:rc10m" }],
  /** Signed-out usage event batches. */
  events: [
    { limit: 10, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:ip:evt10m" },
    { limit: 60, windowMs: 60 * MINUTE_MS, redisWindow: "1 h", prefix: "verdict:ip:evt1h" },
  ],
};

/** Several sliding windows per key, in memory. Checks every window before
 * recording, so a refused request costs no quota. */
export class MultiWindowLimiter {
  private hits = new Map<string, number[]>();
  private readonly longest: number;

  constructor(private readonly windows: readonly { limit: number; windowMs: number }[]) {
    this.longest = Math.max(...windows.map((w) => w.windowMs));
  }

  check(key: string, now = Date.now()): LimitDecision {
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - this.longest);
    for (const { limit, windowMs } of this.windows) {
      const inWindow = recent.filter((t) => t > now - windowMs);
      if (inWindow.length >= limit) {
        return {
          ok: false,
          code: "rate_limited",
          retryAfterSec: retryAfterSec(inWindow[inWindow.length - limit] + windowMs, now),
        };
      }
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) {
      for (const [k, times] of this.hits) {
        if (!times.some((t) => t > now - this.longest)) this.hits.delete(k);
      }
    }
    return { ok: true };
  }
}

const globalForUserLimits = globalThis as unknown as {
  __verdictUserLimiters?: Partial<Record<string, MultiWindowLimiter>>;
  __verdictUserRedis?: Partial<Record<string, Ratelimit[]>>;
};

function windowRedisLimiters(cacheKey: string, windows: readonly UserWindow[]): Ratelimit[] {
  const cache = (globalForUserLimits.__verdictUserRedis ??= {});
  const cached = cache[cacheKey];
  if (cached) return cached;
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    retry: { retries: 1, backoff: () => 100 },
    signal: () => AbortSignal.timeout(REDIS_ATTEMPT_TIMEOUT_MS),
  });
  const limiters = windows.map(
    (w) =>
      new Ratelimit({
        redis,
        timeout: 0,
        analytics: false,
        prefix: w.prefix,
        limiter: Ratelimit.slidingWindow(w.limit, w.redisWindow),
      }),
  );
  cache[cacheKey] = limiters;
  return limiters;
}

/** Counts one use for `subject` against `windows`. Redis when configured
 * (shared across instances), else one in-memory limiter per cacheKey. Fails
 * closed like the IP limits. */
async function checkWindows(
  cacheKey: string,
  subject: string,
  windows: readonly UserWindow[],
): Promise<LimitDecision> {
  if (!redisConfigured()) {
    const limiters = (globalForUserLimits.__verdictUserLimiters ??= {});
    const limiter = (limiters[cacheKey] ??= new MultiWindowLimiter(windows));
    return limiter.check(subject);
  }
  try {
    const work = async (): Promise<LimitDecision> => {
      for (const limiter of windowRedisLimiters(cacheKey, windows)) {
        const res = await limiter.limit(subject);
        if (res.reason === "timeout") throw new Error("rate limit check timed out");
        if (!res.success) {
          return { ok: false, code: "rate_limited", retryAfterSec: retryAfterSec(res.reset, Date.now()) };
        }
      }
      return { ok: true };
    };
    return await withTimeout(work(), REDIS_TOTAL_TIMEOUT_MS);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[ratelimit] Redis user check failed, refusing request:", error);
    return { ok: false, code: "unavailable", error };
  }
}

/** Counts one use of `bucket` for this account, or says why it is refused. */
export async function checkUserLimits(userId: string, bucket: UserBucket): Promise<LimitDecision> {
  return noteLimited(`u:${bucket}`, await checkWindows(`u:${bucket}`, userId, USER_LIMITS[bucket]));
}

/** Counts one use of `bucket` for this visitor IP (keyed hash), or says why
 * it is refused. Same stores and fail-closed behavior as checkUserLimits. */
export async function checkIpLimits(ip: string, bucket: IpBucket): Promise<LimitDecision> {
  return noteLimited(`ip:${bucket}`, await checkWindows(`ip:${bucket}`, visitorKey(ip), IP_LIMITS[bucket]));
}

const DEFAULT_PREMIUM_DAILY_CAP = 500;
const DEFAULT_WELCOME_DAILY_CAP = 100;

function dailyCap(value: string | undefined, fallback: number): number {
  const raw = value?.trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** PREMIUM_DAILY_CAP as a non-negative integer (0 pauses premium). */
export function premiumDailyCap(env: Record<string, string | undefined> = process.env): number {
  return dailyCap(env.PREMIUM_DAILY_CAP, DEFAULT_PREMIUM_DAILY_CAP);
}

/** WELCOME_DAILY_CAP: the share of the daily cap that accounts on their
 * welcome credit alone may use. */
export function welcomeDailyCap(env: Record<string, string | undefined> = process.env): number {
  return dailyCap(env.WELCOME_DAILY_CAP, DEFAULT_WELCOME_DAILY_CAP);
}

/**
 * Site-wide premium cost breaker: refuses once PREMIUM_DAILY_CAP premium
 * pipeline runs have started this UTC day. Counted from the reservations in
 * the main database, refunded ones included (a refused or failed run still
 * cost its model calls), so it holds across restarts and instances without
 * extra state. Clarifying questions are not counted here; the per-account
 * daily clarify window bounds them. An account that never had anything but
 * its welcome credit is also held to WELCOME_DAILY_CAP, so throwaway
 * sign-ups cannot use up the runs paying accounts rely on. Fails closed.
 */
export async function checkPremiumSiteCap(userId: string, now: Date = new Date()): Promise<LimitDecision> {
  const cap = premiumDailyCap();
  const nextDayMs = (Math.floor(now.getTime() / DAY_MS) + 1) * DAY_MS;
  try {
    const ent = await import("./entitlements");
    const full =
      cap === 0 ||
      (await ent.countPremiumToday(now)) >= cap ||
      ((await ent.hasWelcomeCreditOnly(userId)) && (await ent.countWelcomeToday(now)) >= welcomeDailyCap());
    if (full) {
      return { ok: false, code: "daily_cap", retryAfterSec: retryAfterSec(nextDayMs, now.getTime()) };
    }
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[ratelimit] premium daily count failed, refusing request:", error);
    return { ok: false, code: "unavailable", error };
  }
}
