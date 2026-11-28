import type { D1Database, Fetcher, R2Bucket } from "@cloudflare/workers-types/index";

/** Bindings named in wrangler.jsonc. */
export type WorkerEnv = {
  DB: D1Database;
  ASSETS: Fetcher;
  BACKUPS: R2Bucket;
  RATE_LIMITER: LimiterNamespace;
};
/** What the app calls on the RateLimiter object (cloudflare/rate-limiter.ts). */
export type LimiterStub = {
  check(
    windows: { limit: number; windowMs: number }[],
    now?: number,
  ): Promise<{ ok: true } | { ok: false; resetAtMs: number }>;
};
export type LimiterNamespace = { idFromName(name: string): unknown; get(id: unknown): LimiterStub };
