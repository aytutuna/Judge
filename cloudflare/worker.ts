import * as Sentry from "@sentry/cloudflare";
import { sentryOptions } from "../lib/sentry";
import { verdictRemoved } from "../lib/originals/removed";
import { setWorkerEnv } from "../lib/worker-env";
import type { WorkerEnv } from "./env";
// @ts-expect-error: written by `opennextjs-cloudflare build`
import openNext from "../.open-next/worker.js";

export { JobRunner } from "./job-runner";
export { RateLimiter } from "./rate-limiter";

/** The longest request body an /api route takes (an evidence upload is 16 MB). */
const MAX_API_BODY = 17 * 1024 * 1024;

/** Cron expression -> /api/internal/cron task (wrangler.jsonc triggers.crons). */
const CRON_TASKS: Record<string, string> = {
  "*/5 * * * *": "sweep",
  "17 3 * * *": "daily",
  "30 3 * * *": "backup",
};

const SHARE_PAGE = /^\/v\/[A-Za-z0-9_-]{1,64}$/;

/** What proxy.ts does on Node: a removed verdict's page answers 410, and 503
 * when the check itself fails, never the verdict. */
async function removedPage(request: Request, env: Env, ctx: ExecutionContext, id: string): Promise<Response | null> {
  let state: "removed" | "unavailable";
  try {
    if (!(await verdictRemoved(id))) return null;
    state = "removed";
  } catch (e) {
    console.error("[worker] removed check failed:", e instanceof Error ? e.message : String(e));
    state = "unavailable";
  }
  const page = new Request(new URL(`/api/internal/removed?state=${state}`, request.url), { headers: request.headers });
  return openNext.fetch(page, env, ctx);
}

const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

type Env = WorkerEnv & { JOB_SECRET: string };

const handler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    setWorkerEnv(env);
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") && Number(request.headers.get("content-length")) > MAX_API_BODY) {
      return new Response("Payload Too Large\n", { status: 413 });
    }
    const share = SHARE_PAGE.test(url.pathname) ? await removedPage(request, env, ctx, url.pathname.slice(3)) : null;
    const res: Response = share ?? (await openNext.fetch(request, env, ctx));
    if (res.status === 101) return res;
    const out = new Response(res.body, res);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(name, value);
    return out;
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    setWorkerEnv(env);
    const task = CRON_TASKS[controller.cron];
    if (!task) return;
    ctx.waitUntil(
      env.WORKER_SELF_REFERENCE.fetch(`https://judge.internal/api/internal/cron?task=${task}`, {
        method: "POST",
        headers: { "x-internal-secret": env.JOB_SECRET },
      }).then((res) => {
        if (!res.ok) console.error(`[cron] ${task} answered HTTP ${res.status}`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;

export default Sentry.withSentry(
  (env: Env & { SENTRY_DSN?: string; SENTRY_RELEASE?: string }) => ({
    ...sentryOptions,
    dsn: env.SENTRY_DSN || undefined,
    release: env.SENTRY_RELEASE || undefined,
  }),
  handler,
);
