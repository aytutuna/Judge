import { DurableObject } from "cloudflare:workers";
import { slideCheck, type Counter, type Window } from "../lib/sliding-window";

export type LimiterAnswer = { ok: true } | { ok: false; resetAtMs: number };

/** One object per (bucket, visitor or account): the counters of that
 * bucket's windows. Deletes itself once both windows have gone quiet. */
export class RateLimiter extends DurableObject<{ SENTRY_DSN?: string }> {
  async check(windows: Window[], now: number = Date.now()): Promise<LimiterAnswer> {
    const stored = await this.ctx.storage.get<Counter[]>("c");
    const res = slideCheck(stored ?? [], windows, now);
    if (!res.ok) return res;
    await this.ctx.storage.put("c", res.counters);
    await this.ctx.storage.setAlarm(now + 2 * Math.max(...windows.map((w) => w.windowMs)));
    return { ok: true };
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
