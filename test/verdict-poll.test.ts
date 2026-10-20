import { describe, expect, it } from "vitest";
import { nextPollDelay, pollVerdict, POLL_POLICY, wantsAsync, type PollDeps } from "../lib/verdict-poll";

const READY = { id: "abc", status: "ready", result: { verdict: "side_a" }, createdAt: "t", display: null };

type Step = { status: number; body?: unknown; retryAfter?: string } | "network";

/** A scripted server plus a fake clock that sleep() advances. */
function harness(steps: Step[], over: Partial<PollDeps> = {}) {
  let clock = 0;
  const waits: number[] = [];
  const urls: string[] = [];
  const sent: Record<string, string>[] = [];
  const deps: PollDeps = {
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    fetch: async (url, init) => {
      urls.push(url);
      sent.push(init.headers);
      const step = steps.shift() ?? { status: 200, body: { id: "abc", status: "judging", pollAfterMs: 2000 } };
      if (step === "network") throw new TypeError("Failed to fetch");
      return {
        status: step.status,
        headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? (step.retryAfter ?? null) : null) },
        json: async () => {
          if (step.body === undefined) throw new SyntaxError("not json");
          return step.body;
        },
      };
    },
    ...over,
  };
  return { deps, waits, urls, sent, elapsed: () => clock };
}

const judging = (pollAfterMs = 2000): Step => ({ status: 200, body: { id: "abc", status: "judging", pollAfterMs } });

describe("wantsAsync", () => {
  const h = (v: string | null) => ({ get: (n: string) => (n === "prefer" ? v : null) });
  it("reads the Prefer token (case and parameters ignored) or body async: true", () => {
    expect(wantsAsync(h("respond-async"), {})).toBe(true);
    expect(wantsAsync(h("wait=10, Respond-Async; x=1"), {})).toBe(true);
    expect(wantsAsync(h("return=minimal"), {})).toBe(false);
    expect(wantsAsync(h(null), { async: true })).toBe(true);
    expect(wantsAsync(h(null), { async: "true" })).toBe(false);
    expect(wantsAsync(h(null), null)).toBe(false);
  });
});

describe("nextPollDelay", () => {
  it("grows 1.5x from 2 s up to 5 s while the server answers", () => {
    expect([0, 1, 2, 3, 4, 10].map((a) => nextPollDelay(a))).toEqual([2000, 3000, 4500, 5000, 5000, 5000]);
  });
  it("backs off harder after errors, capped at 15 s; a larger server hint wins", () => {
    expect([1, 2, 3, 4, 8].map((e) => nextPollDelay(0, { errors: e }))).toEqual([4000, 8000, 15000, 15000, 15000]);
    expect(nextPollDelay(0, { hintMs: 9000 })).toBe(9000);
    expect(nextPollDelay(5, { hintMs: 100 })).toBe(5000);
    expect(nextPollDelay(0, { hintMs: 10 * 60_000 })).toBe(60_000);
  });
});

describe("pollVerdict", () => {
  it("waits the first delay, polls with backoff while judging, returns the ready verdict", async () => {
    const t = harness([judging(), judging(), { status: 200, body: READY }]);
    const out = await pollVerdict("abc", { ...t.deps, firstDelayMs: 2000, ownerToken: "tok" });
    expect(out).toEqual({ kind: "ready", body: READY });
    expect(t.waits).toEqual([2000, 3000, 4500]);
    expect(t.urls[0]).toBe("/api/v1/verdicts/abc");
    expect(t.sent[0]["X-Owner-Token"]).toBe("tok");
  });

  it("keeps polling through network errors, 5xx, proxy pages and 429 (honouring Retry-After)", async () => {
    const t = harness([
      "network",
      { status: 524 },
      { status: 503, body: { code: "unavailable" } },
      { status: 429, body: { code: "rate_limited" }, retryAfter: "20" },
      judging(),
      { status: 200, body: READY },
    ]);
    const out = await pollVerdict("abc", t.deps);
    expect(out.kind).toBe("ready");
    // first, then errors 1..4 (the 429 waits its 20 s), then back to steady.
    expect(t.waits).toEqual([2000, 4000, 8000, 15000, 20000, 3000]);
  });

  it("ends on failed with the stable code", async () => {
    const t = harness([judging(), { status: 200, body: { id: "abc", status: "failed", code: "quota", error: "x" } }]);
    expect(await pollVerdict("abc", t.deps)).toMatchObject({ kind: "failed", code: "quota", status: 200 });
  });

  it("ends on 410 removed and 404 not_found", async () => {
    let t = harness([{ status: 410, body: { code: "removed", error: "x" } }]);
    expect(await pollVerdict("abc", t.deps)).toMatchObject({ kind: "failed", code: "removed", status: 410 });
    t = harness([{ status: 404 }]);
    expect(await pollVerdict("abc", t.deps)).toMatchObject({ kind: "failed", code: "not_found", status: 404 });
  });

  it("accepts a ready verdict from a server without the status field", async () => {
    const { status: _s, ...legacy } = READY;
    void _s;
    const t = harness([{ status: 200, body: legacy }]);
    expect(await pollVerdict("abc", t.deps)).toEqual({ kind: "ready", body: { ...legacy, status: "ready" } });
  });

  it("gives up at the deadline", async () => {
    const t = harness([], { deadlineMs: 30_000 });
    expect(await pollVerdict("abc", t.deps)).toEqual({ kind: "timeout" });
    expect(t.elapsed()).toBe(30_000);
    expect(POLL_POLICY.deadlineMs).toBeGreaterThan(10 * 60_000);
  });

  it("stops when the signal is aborted", async () => {
    const signal = { aborted: false };
    const t = harness([judging()]);
    const deps: PollDeps = {
      ...t.deps,
      signal,
      fetch: async (url, init) => {
        signal.aborted = true;
        return t.deps.fetch(url, init);
      },
    };
    expect(await pollVerdict("abc", deps)).toEqual({ kind: "aborted" });
  });

  it("drops a poll that hangs past requestTimeoutMs, aborts its fetch and backs off", async () => {
    const t = harness([{ status: 200, body: READY }]);
    const seen: (AbortSignal | undefined)[] = [];
    let hung = true;
    const deps: PollDeps = {
      ...t.deps,
      requestTimeoutMs: 20,
      fetch: (url, init) => {
        seen.push(init.signal);
        if (hung) {
          hung = false;
          return new Promise(() => {}); // a dead connection: never settles
        }
        return t.deps.fetch(url, init);
      },
    };
    const out = await pollVerdict("abc", deps);
    expect(out.kind).toBe("ready");
    expect(seen[0]?.aborted).toBe(true);
    expect(seen[1]?.aborted).toBe(false);
    // The hung poll counts as one network error.
    expect(t.waits).toEqual([2000, 4000]);
  });

  it("also bounds a response whose body never arrives", async () => {
    const t = harness([{ status: 200, body: READY }]);
    let hung = true;
    const deps: PollDeps = {
      ...t.deps,
      requestTimeoutMs: 20,
      fetch: async (url, init) => {
        if (hung) {
          hung = false;
          return { status: 200, headers: { get: () => null }, json: () => new Promise(() => {}) };
        }
        return t.deps.fetch(url, init);
      },
    };
    expect((await pollVerdict("abc", deps)).kind).toBe("ready");
  });

  it("an AbortSignal cancels the poll in flight", async () => {
    const t = harness([]);
    const ctl = new AbortController();
    let inner: AbortSignal | undefined;
    const deps: PollDeps = {
      ...t.deps,
      signal: ctl.signal,
      fetch: (_url, init) => {
        inner = init.signal;
        setTimeout(() => ctl.abort(), 5);
        return new Promise(() => {});
      },
    };
    expect(await pollVerdict("abc", deps)).toEqual({ kind: "aborted" });
    expect(inner?.aborted).toBe(true);
  });
});
