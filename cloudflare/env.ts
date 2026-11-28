import type { D1Database, DurableObjectNamespace, Fetcher, R2Bucket } from "@cloudflare/workers-types/index";

/** Bindings named in wrangler.jsonc. */
export type WorkerEnv = {
  DB: D1Database;
  ASSETS: Fetcher;
  BACKUPS: R2Bucket;
};
export type { D1Database, DurableObjectNamespace, R2Bucket };
