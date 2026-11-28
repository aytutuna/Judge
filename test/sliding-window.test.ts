import { afterEach, describe, expect, it } from "vitest";
import type { WorkerEnv } from "../cloudflare/env";
import { checkIpLimits, checkTranslateLimits, checkUserLimits, TRANSLATE_LIMIT } from "../lib/ratelimit";
import { slideCheck, type Counter } from "../lib/sliding-window";
import { setWorkerEnv } from "../lib/worker-env";

const MIN = 60_000;

function run(windows: { limit: number; windowMs: number }[], times: number[]): boolean[] {
  let counters: Counter[] = [];
  return times.map((t) => {
    const res = slideCheck(counters, windows, t);
    if (res.ok) counters = res.counters;
    return res.ok;
  });
}

describe("slideCheck", () => {
  it("allows the limit inside one window and refuses the next", () => {
    expect(run([{ limit: 3, windowMs: 10 * MIN }], [1, 2, 3, 4])).toEqual([true, true, true, false]);
  });

  it("lets the previous window's count fade out as the next one passes", () => {
    const w = [{ limit: 4, windowMs: 10 * MIN }];
    // Four requests at the end of window 0, then a fifth as window 1 opens: still full.
    const [a, b, c, d, early] = run(w, [9 * MIN, 9 * MIN, 9 * MIN, 9 * MIN, 10 * MIN]);
    expect([a, b, c, d, early]).toEqual([true, true, true, true, false]);
    // Late in window 1 only a tenth of the old count is left.
    expect(run(w, [9 * MIN, 9 * MIN, 9 * MIN, 9 * MIN, 19 * MIN])).toEqual([true, true, true, true, true]);
  });

  it("counts nothing for a refused request and records every window together", () => {
    const w = [
      { limit: 5, windowMs: MIN },
      { limit: 2, windowMs: 60 * MIN },
    ];
    expect(run(w, [1, 2, 3])).toEqual([true, true, false]);
  });

  it("reports the end of the window that refused", () => {
    const first = slideCheck([], [{ limit: 1, windowMs: 10 * MIN }], 5 * MIN);
    if (!first.ok) throw new Error("expected ok");
    expect(slideCheck(first.counters, [{ limit: 1, windowMs: 10 * MIN }], 6 * MIN)).toEqual({ ok: false, resetAtMs: 10 * MIN + 1 });
  });
});

describe("the retry time", () => {
  /** The first time after `from` that a request passes, found by trying. */
  function firstPassAfter(windows: { limit: number; windowMs: number }[], counters: Counter[], from: number): number {
    for (let t = from; t < from + 3 * windows[0].windowMs; t += 1000) if (slideCheck(counters, windows, t).ok) return t;
    return -1;
  }

  it("is when the request really passes, not just the end of the window", () => {
    const w = [{ limit: 10, windowMs: 10 * MIN }];
    // 10 requests late in window 0, the 11th early in window 1: the old window still weighs on it.
    let counters: Counter[] = [];
    for (let i = 0; i < 10; i++) {
      const r = slideCheck(counters, w, 9 * MIN + i);
      if (r.ok) counters = r.counters;
    }
    const first = slideCheck(counters, w, 10 * MIN + 1000);
    if (!first.ok) throw new Error("expected the first request of the new window to pass");
    counters = first.counters;
    const at = 10 * MIN + 2000;
    const refused = slideCheck(counters, w, at);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(slideCheck(counters, w, refused.resetAtMs).ok).toBe(true);
    expect(refused.resetAtMs).toBeGreaterThan(at);
    expect(refused.resetAtMs - firstPassAfter(w, counters, at)).toBeLessThan(2000);
  });
});

/** The RateLimiter object's behavior, one in-memory instance per name. */
function fakeNamespace() {
  const state = new Map<string, Counter[]>();
  const namespace = {
    jurisdiction: () => namespace,
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      check: async (windows: { limit: number; windowMs: number }[], now = Date.now()) => {
        const res = slideCheck(state.get(id as string) ?? [], windows, now);
        if (res.ok) state.set(id as string, res.counters);
        return res.ok ? { ok: true as const } : res;
      },
    }),
  };
  return namespace;
}

describe("limits through the Durable Object", () => {
  afterEach(() => setWorkerEnv(undefined as unknown as WorkerEnv));

  it("counts per account and per bucket across calls", async () => {
    setWorkerEnv({ RATE_LIMITER: fakeNamespace() } as unknown as WorkerEnv);
    for (let i = 0; i < 5; i++) expect((await checkUserLimits("user-1", "welcome_clarify")).ok).toBe(true);
    const sixth = await checkUserLimits("user-1", "welcome_clarify");
    expect(sixth).toMatchObject({ ok: false, code: "rate_limited" });
    expect((await checkUserLimits("user-2", "welcome_clarify")).ok).toBe(true);
    expect((await checkIpLimits("203.0.113.9", "respond_submit")).ok).toBe(true);
  });

  it("limits translations per visitor", async () => {
    setWorkerEnv({ RATE_LIMITER: fakeNamespace() } as unknown as WorkerEnv);
    for (let i = 0; i < TRANSLATE_LIMIT; i++) expect((await checkTranslateLimits("203.0.113.10")).ok).toBe(true);
    expect(await checkTranslateLimits("203.0.113.10")).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("refuses as unavailable when the object cannot be reached", async () => {
    const broken = { jurisdiction: () => broken, idFromName: (n: string) => n, get: () => ({ check: async () => { throw new Error("down"); } }) };
    setWorkerEnv({ RATE_LIMITER: broken } as unknown as WorkerEnv);
    expect(await checkUserLimits("user-3", "clarify")).toMatchObject({ ok: false, code: "unavailable" });
  });
});

describe("Durable Object jurisdiction", () => {
  afterEach(() => setWorkerEnv(undefined as unknown as WorkerEnv));

  it("asks for objects in the EU when DO_JURISDICTION says so, and not otherwise", async () => {
    const asked: string[] = [];
    const ns = fakeNamespace();
    const eu = { ...ns, jurisdiction: () => ns };
    setWorkerEnv({ RATE_LIMITER: { ...ns, jurisdiction: (j: string) => (asked.push(j), eu) } } as unknown as WorkerEnv);
    await checkUserLimits("user-a", "clarify");
    expect(asked).toEqual([]);
    process.env.DO_JURISDICTION = "eu";
    try {
      await checkUserLimits("user-eu", "clarify");
    } finally {
      delete process.env.DO_JURISDICTION;
    }
    expect(asked).toEqual(["eu"]);
  });
});
