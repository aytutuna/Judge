import { DurableObject } from "cloudflare:workers";
import { expiresAt, slideCheck, type Counter, type Window } from "../lib/sliding-window";

export type LimiterAnswer = { ok: true } | { ok: false; resetAtMs: number };

/** One object per (bucket, visitor or account): the counters of that
 * bucket's windows. Deletes itself once they have gone quiet for two windows. */
export class RateLimiter extends DurableObject<{ SENTRY_DSN?: string }> {
  async check(windows: Window[], now: number = Date.now()): Promise<LimiterAnswer> {
    const stored = await this.ctx.storage.get<Counter[]>("c");
    const res = slideCheck(stored ?? [], windows, now);
    if (!res.ok) return res;
    await this.ctx.storage.put("c", res.counters);
    // One alarm is enough: it moves itself on while counters are still live.
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(expiresAt(res.counters));
    return { ok: true };
  }

  async alarm(): Promise<void> {
    const counters = await this.ctx.storage.get<Counter[]>("c");
    const until = counters?.length ? expiresAt(counters) : 0;
    if (until > Date.now()) await this.ctx.storage.setAlarm(until);
    else await this.ctx.storage.deleteAll();
  }
}
