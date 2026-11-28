import type { D1Database, Fetcher, R2Bucket } from "@cloudflare/workers-types/index";

/** Bindings named in wrangler.jsonc. */
export type WorkerEnv = {
  DB: D1Database;
  ASSETS: Fetcher;
  BACKUPS: R2Bucket;
  RATE_LIMITER: LimiterNamespace;
  JOBS: RunnerNamespace;
  WORKER_SELF_REFERENCE: Fetcher;
};
/** What the app calls on the RateLimiter object (cloudflare/rate-limiter.ts). */
export type LimiterStub = {
  check(
    windows: { limit: number; windowMs: number }[],
    now?: number,
  ): Promise<{ ok: true } | { ok: false; resetAtMs: number }>;
};
/** What the app calls on the JobRunner object (cloudflare/job-runner.ts). */
export type RunnerNamespace = {
  idFromName(name: string): unknown;
  jurisdiction(name: "eu"): RunnerNamespace;
  get(id: unknown): { enqueue(job: { name: string; args: unknown[] }): Promise<void> };
};
export type LimiterNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): LimiterStub;
  jurisdiction(name: "eu"): LimiterNamespace;
};
