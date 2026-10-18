/**
 * Abuse and cost limits, checked before any model call:
 * - per visitor IP: 5 verdicts / 10 minutes and 20 / 24 hours (sliding);
 * - site-wide: DAILY_VERDICT_CAP verdicts per UTC day (default 1000).
 *
 * Backed by Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are set, so the
 * limits hold across every serverless instance. Without them an in-memory
 * store is used: fine for local dev, but per instance only.
 *
 * Fails closed: if Redis errors or is slow, the request is refused as
 * "unavailable" rather than let through unmetered.
 */

import { createHmac } from "node:crypto";
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

  /** Drops visitors with nothing left in the 24-hour window. */
  private sweep(now: number): void {
    for (const [key, times] of this.visits) {
      if (!times.some((t) => t > now - IP_DAILY_WINDOW_MS)) this.visits.delete(key);
    }
  }
}

type RedisLimiters = { cap: number; short: Ratelimit; daily: Ratelimit; site: Ratelimit };

const globalForLimits = globalThis as unknown as {
  __verdictMemoryLimiter?: MemoryLimiter;
  __verdictRedisLimiters?: RedisLimiters;
};

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
    globalForLimits.__verdictMemoryLimiter ??= new MemoryLimiter();
    return globalForLimits.__verdictMemoryLimiter.check(visitor, cap);
  }
  try {
    return await withTimeout(checkRedis(visitor, cap), REDIS_TOTAL_TIMEOUT_MS);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[ratelimit] Redis check failed, refusing request:", error);
    return { ok: false, code: "unavailable", error };
  }
}
