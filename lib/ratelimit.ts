/**
 * Abuse and cost limits, checked before any model call:
 * - per visitor IP: 5 verdicts / 10 minutes and 20 / 24 hours (sliding);
 * - site-wide: DAILY_VERDICT_CAP verdicts per UTC day (default 1000).
 *
 * Backed by Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are set, so the
 * limits hold across every serverless instance. Without them an in-memory
 * store is used, per process only. On a single server, RATE_LIMIT_DB (a
 * libSQL file URL) makes that store survive app restarts: every counted
 * verdict is also written there, and a fresh process reloads the last 24 hours.
 *
 * Fails closed: if Redis or the limit database errors or is slow, the request
 * is refused as "unavailable" rather than let through unmetered.
 */

import { createHmac } from "node:crypto";
import { createClient, type Client } from "@libsql/client";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { rateLimitSubject } from "./client-ip";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const IP_SHORT_LIMIT = 5;
export const IP_SHORT_WINDOW_MS = 10 * MINUTE_MS;
export const IP_DAILY_LIMIT = 20;
export const IP_DAILY_WINDOW_MS = DAY_MS;
const DEFAULT_DAILY_CAP = 1000;

/** Per Redis HTTP attempt, and for the whole check. Keeps a sick Redis from
 * stalling the request; the verdict is refused instead. */
const REDIS_ATTEMPT_TIMEOUT_MS = 1_500;
const REDIS_TOTAL_TIMEOUT_MS = 3_000;

export type LimitDecision =
  | { ok: true }
  | { ok: false; code: "rate_limited" | "daily_cap"; retryAfterSec: number }
  | { ok: false; code: "unavailable"; error: string };

/** DAILY_VERDICT_CAP as a non-negative integer (0 pauses the site). */
export function dailyCap(): number {
  const raw = process.env.DAILY_VERDICT_CAP;
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_CAP;
}

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

/**
 * Single-process store. Each visitor keeps the timestamps of their verdicts
 * in the last 24 hours (at most IP_DAILY_LIMIT), which answers both IP
 * windows; the site-wide cap is a counter per UTC day. Checks all limits
 * before recording anything, so a refused request costs no quota.
 */
export class MemoryLimiter {
  private visits = new Map<string, number[]>();
  private day = -1;
  private dayCount = 0;

  check(visitor: string, cap: number, now = Date.now()): LimitDecision {
    const recent = (this.visits.get(visitor) ?? []).filter((t) => t > now - IP_DAILY_WINDOW_MS);
    const short = recent.filter((t) => t > now - IP_SHORT_WINDOW_MS);
    if (short.length >= IP_SHORT_LIMIT) {
      return {
        ok: false,
        code: "rate_limited",
        retryAfterSec: retryAfterSec(short[0] + IP_SHORT_WINDOW_MS, now),
      };
    }
    if (recent.length >= IP_DAILY_LIMIT) {
      return {
        ok: false,
        code: "rate_limited",
        retryAfterSec: retryAfterSec(recent[0] + IP_DAILY_WINDOW_MS, now),
      };
    }

    const day = Math.floor(now / DAY_MS);
    if (day !== this.day) {
      this.day = day;
      this.dayCount = 0;
    }
    if (this.dayCount >= cap) {
      return { ok: false, code: "daily_cap", retryAfterSec: retryAfterSec((day + 1) * DAY_MS, now) };
    }

    this.dayCount += 1;
    recent.push(now);
    this.visits.set(visitor, recent);
    if (this.visits.size > 10_000) this.sweep(now);
    return { ok: true };
  }

  /** Replaces the state with previously counted verdicts (oldest first), as
   * if check() had allowed each of them. */
  restore(hits: readonly LimitHit[], now = Date.now()): void {
    this.visits.clear();
    this.day = Math.floor(now / DAY_MS);
    this.dayCount = 0;
    for (const { visitor, at } of hits) {
      if (Math.floor(at / DAY_MS) === this.day) this.dayCount += 1;
      if (at <= now - IP_DAILY_WINDOW_MS) continue;
      const times = this.visits.get(visitor);
      if (times) times.push(at);
      else this.visits.set(visitor, [at]);
    }
  }

  /** Drops visitors with nothing left in the 24-hour window. */
  private sweep(now: number): void {
    for (const [key, times] of this.visits) {
      if (!times.some((t) => t > now - IP_DAILY_WINDOW_MS)) this.visits.delete(key);
    }
  }
}

/** One counted verdict: who (the visitor key) and when (epoch ms). */
export type LimitHit = { visitor: string; at: number };

const PRUNE_EVERY_MS = 60 * MINUTE_MS;

/**
 * MemoryLimiter plus an append-only log of the verdicts it allowed, kept in a
 * small SQLite table. The decisions stay in memory (one process, so they are
 * atomic); the log only lets a restarted process rebuild the same state.
 * Rows older than 24 hours are deleted on load, on every write and hourly.
 */
export class PersistentLimiter {
  private memory: Promise<MemoryLimiter> | undefined;
  private ready: Promise<void> | undefined;
  private pruneTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly client: Client) {}

  async check(visitor: string, cap: number, now = Date.now()): Promise<LimitDecision> {
    this.memory ??= this.load(now).catch((e: unknown) => {
      // Let the next request retry instead of caching the failure.
      this.memory = undefined;
      throw e;
    });
    const memory = await this.memory;
    const decision = memory.check(visitor, cap, now);
    // If this write fails the verdict stays counted in memory (the safe
    // side) and the caller refuses the request.
    if (decision.ok) {
      await this.client.batch(
        [
          { sql: "INSERT INTO rate_hits (visitor, at) VALUES (?, ?)", args: [visitor, now] },
          { sql: "DELETE FROM rate_hits WHERE at <= ?", args: [now - IP_DAILY_WINDOW_MS] },
        ],
        "write",
      );
    }
    return decision;
  }

  /** Stops the hourly cleanup and closes the database. */
  close(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.client.close();
  }

  private init(): Promise<void> {
    this.ready ??= this.client
      .batch(
        [
          "CREATE TABLE IF NOT EXISTS rate_hits (visitor TEXT NOT NULL, at INTEGER NOT NULL)",
          "CREATE INDEX IF NOT EXISTS rate_hits_at ON rate_hits (at)",
        ],
        "write",
      )
      .then(() => undefined)
      .catch((e: unknown) => {
        this.ready = undefined;
        throw e;
      });
    return this.ready;
  }

  private async load(now: number): Promise<MemoryLimiter> {
    await this.init();
    await this.prune(now);
    const rs = await this.client.execute("SELECT visitor, at FROM rate_hits ORDER BY at");
    const memory = new MemoryLimiter();
    memory.restore(
      rs.rows.map((row) => ({ visitor: String(row.visitor), at: Number(row.at) })),
      now,
    );
    // Also clean up when no verdicts arrive, so no key outlives 24 hours.
    this.pruneTimer ??= setInterval(() => {
      this.prune(Date.now()).catch((e: unknown) => {
        console.error("[ratelimit] cleaning the limit database failed:", e);
      });
    }, PRUNE_EVERY_MS);
    this.pruneTimer.unref?.();
    return memory;
  }

  private async prune(now: number): Promise<void> {
    await this.client.execute({
      sql: "DELETE FROM rate_hits WHERE at <= ?",
      args: [now - IP_DAILY_WINDOW_MS],
    });
  }
}

/** RATE_LIMIT_DB as given, or null when unset (limits then live in memory only). */
export function limitDbUrl(env: Record<string, string | undefined> = process.env): string | null {
  return env.RATE_LIMIT_DB?.trim() || null;
}

type RedisLimiters = { cap: number; short: Ratelimit; daily: Ratelimit; site: Ratelimit };

const globalForLimits = globalThis as unknown as {
  __verdictMemoryLimiter?: MemoryLimiter;
  __verdictPersistentLimiter?: { url: string; limiter: PersistentLimiter };
  __verdictRedisLimiters?: RedisLimiters;
};

function persistentLimiter(url: string): PersistentLimiter {
  const cached = globalForLimits.__verdictPersistentLimiter;
  if (cached?.url === url) return cached.limiter;
  cached?.limiter.close();
  const limiter = new PersistentLimiter(createClient({ url }));
  globalForLimits.__verdictPersistentLimiter = { url, limiter };
  return limiter;
}

function redisLimiters(cap: number): RedisLimiters {
  const cached = globalForLimits.__verdictRedisLimiters;
  if (cached && cached.cap === cap) return cached;
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    retry: { retries: 1, backoff: () => 100 },
    // A function, so each request gets a fresh deadline (and a timed-out
    // request throws instead of resolving).
    signal: () => AbortSignal.timeout(REDIS_ATTEMPT_TIMEOUT_MS),
  });
  // timeout: 0 turns off the library's own timeout, which would ALLOW the
  // request when Redis is slow. Our deadline refuses it instead.
  const common = { redis, timeout: 0, analytics: false } as const;
  const limiters: RedisLimiters = {
    cap,
    short: new Ratelimit({
      ...common,
      prefix: "verdict:ip10m",
      limiter: Ratelimit.slidingWindow(IP_SHORT_LIMIT, "10 m"),
    }),
    daily: new Ratelimit({
      ...common,
      prefix: "verdict:ipday",
      limiter: Ratelimit.slidingWindow(IP_DAILY_LIMIT, "1 d"),
    }),
    // A fixed 1-day window is aligned to the Unix epoch, i.e. to UTC days.
    site: new Ratelimit({
      ...common,
      prefix: "verdict:site",
      limiter: Ratelimit.fixedWindow(cap, "1 d"),
    }),
  };
  globalForLimits.__verdictRedisLimiters = limiters;
  return limiters;
}

/** IP windows first, the site-wide cap last: a visitor already over their
 * own limit never eats into everyone's daily capacity. */
async function checkRedis(visitor: string, cap: number): Promise<LimitDecision> {
  const { short, daily, site } = redisLimiters(cap);
  const steps: [Ratelimit, string, "rate_limited" | "daily_cap"][] = [
    [short, visitor, "rate_limited"],
    [daily, visitor, "rate_limited"],
    [site, "all", "daily_cap"],
  ];
  for (const [limiter, id, code] of steps) {
    const res = await limiter.limit(id);
    if (res.reason === "timeout") throw new Error("rate limit check timed out");
    if (!res.success) return { ok: false, code, retryAfterSec: retryAfterSec(res.reset, Date.now()) };
  }
  return { ok: true };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`rate limit check exceeded ${ms}ms`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** Counts one verdict attempt for this IP, or says why it is refused. */
export async function checkVerdictLimits(ip: string): Promise<LimitDecision> {
  const visitor = visitorKey(ip);
  const cap = dailyCap();
  if (!redisConfigured()) {
    const url = limitDbUrl();
    if (!url) {
      globalForLimits.__verdictMemoryLimiter ??= new MemoryLimiter();
      return globalForLimits.__verdictMemoryLimiter.check(visitor, cap);
    }
    try {
      return await persistentLimiter(url).check(visitor, cap);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error("[ratelimit] limit database failed, refusing request:", error);
      return { ok: false, code: "unavailable", error };
    }
  }
  try {
    return await withTimeout(checkRedis(visitor, cap), REDIS_TOTAL_TIMEOUT_MS);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[ratelimit] Redis check failed, refusing request:", error);
    return { ok: false, code: "unavailable", error };
  }
}

/** New translations per visitor IP per 10 minutes. Separate from the verdict
 * limits and the site-wide cap: one translation is a single cheap call and
 * each (verdict, language) pair is translated at most once, ever. */
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
 * is not persisted across restarts even with RATE_LIMIT_DB: a restart can at
 * most grant one fresh window of cheap, once-per-pair calls. Fails closed
 * like the verdict limits.
 */
export async function checkTranslateLimits(ip: string): Promise<LimitDecision> {
  const visitor = visitorKey(ip);
  if (!redisConfigured()) {
    globalForTranslateLimits.__verdictTranslateLimiter ??= new WindowLimiter(
      TRANSLATE_LIMIT,
      TRANSLATE_WINDOW_MS,
    );
    return globalForTranslateLimits.__verdictTranslateLimiter.check(visitor);
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
      return { ok: false, code: "rate_limited", retryAfterSec: retryAfterSec(res.reset, Date.now()) };
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
 * their cost per account). */
export type UserBucket =
  | "premium_verdict"
  | "clarify"
  | "case_create"
  | "evidence"
  | "case_evidence"
  | "verdict_owner"
  | "apple_code";

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
  case_create: [
    { limit: 10, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:u:cc10m" },
    { limit: 30, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:u:ccday" },
  ],
  evidence: [
    { limit: 30, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:u:ev10m" },
    { limit: 150, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:u:evday" },
  ],
  /** Keyed "case:<id>:b": respondent uploads per case. */
  case_evidence: [{ limit: 12, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:c:evday" }],
  /** A writer reading or changing their own verdicts and case sides (session). */
  verdict_owner: [
    { limit: 60, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:u:vo10m" },
    { limit: 300, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:u:voday" },
  ],
  /** The app sending an Apple authorization code (one Apple round trip each). */
  apple_code: [
    { limit: 10, windowMs: 10 * MINUTE_MS, redisWindow: "10 m", prefix: "verdict:u:ac10m" },
    { limit: 30, windowMs: DAY_MS, redisWindow: "1 d", prefix: "verdict:u:acday" },
  ],
};

/** Per-IP buckets for the no-account endpoints (keyed by visitorKey):
 * respondents, signed-out writers using their owner token or claim, and
 * polls of verdicts still judging (a poll every 2 to 5 s for a few minutes
 * is about 100; the windows leave room for several verdicts and a shared
 * address). */
export type IpBucket = "respond_submit" | "respond_evidence" | "verdict_owner" | "verdict_poll" | "revenuecat_webhook";

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
  return checkWindows(`u:${bucket}`, userId, USER_LIMITS[bucket]);
}

/** Counts one use of `bucket` for this visitor IP (keyed hash), or says why
 * it is refused. Same stores and fail-closed behavior as checkUserLimits. */
export async function checkIpLimits(ip: string, bucket: IpBucket): Promise<LimitDecision> {
  return checkWindows(`ip:${bucket}`, visitorKey(ip), IP_LIMITS[bucket]);
}

const DEFAULT_PREMIUM_DAILY_CAP = 500;

/** PREMIUM_DAILY_CAP as a non-negative integer (0 pauses premium). */
export function premiumDailyCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env.PREMIUM_DAILY_CAP?.trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? n : DEFAULT_PREMIUM_DAILY_CAP;
}

/**
 * Site-wide premium cost breaker: refuses once PREMIUM_DAILY_CAP premium
 * pipeline runs have started this UTC day. Counted from the reservations in
 * the main database, refunded ones included (a refused or failed run still
 * cost its model calls), so it holds across restarts and instances without
 * extra state. Clarifying questions are not counted here; the per-account
 * daily clarify window bounds them. Fails closed.
 */
export async function checkPremiumSiteCap(now: Date = new Date()): Promise<LimitDecision> {
  const cap = premiumDailyCap();
  const nextDayMs = (Math.floor(now.getTime() / DAY_MS) + 1) * DAY_MS;
  try {
    const { countPremiumToday } = await import("./entitlements");
    const count = cap === 0 ? 0 : await countPremiumToday(now);
    if (count >= cap) {
      return { ok: false, code: "daily_cap", retryAfterSec: retryAfterSec(nextDayMs, now.getTime()) };
    }
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[ratelimit] premium daily count failed, refusing request:", error);
    return { ok: false, code: "unavailable", error };
  }
}
