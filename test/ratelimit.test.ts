import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  checkVerdictLimits,
  dailyCap,
  IP_DAILY_LIMIT,
  IP_SHORT_LIMIT,
  limitDbUrl,
  MemoryLimiter,
  PersistentLimiter,
  visitorKey,
} from "../lib/ratelimit";

const tmp = mkdtempSync(path.join(tmpdir(), "verdict-limits-"));
let dbCount = 0;
/** A fresh libSQL file URL under the test's temp directory. */
function tempDbUrl(): string {
  dbCount += 1;
  return fileUrl(path.join(tmp, `limits-${dbCount}.db`));
}
function fileUrl(p: string): string {
  return `file:${p.replace(/\\/g, "/")}`;
}
const opened: PersistentLimiter[] = [];
/** A limiter on `url`, as a freshly started app process would create it. */
function openLimiter(url: string): PersistentLimiter {
  const l = new PersistentLimiter(createClient({ url }));
  opened.push(l);
  return l;
}

afterAll(() => {
  for (const l of opened) l.close();
  const g = globalThis as unknown as { __verdictPersistentLimiter?: { limiter: PersistentLimiter } };
  g.__verdictPersistentLimiter?.limiter.close();
  // Best effort: Windows can hold the files briefly after close.
  try {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
// Noon UTC on some day, so day-boundary arithmetic is easy to read.
const NOON = Date.UTC(2026, 9, 18, 12, 0, 0);

describe("MemoryLimiter", () => {
  it("allows 5 per 10 minutes, then refuses with the time until the oldest expires", () => {
    const l = new MemoryLimiter();
    for (let i = 0; i < IP_SHORT_LIMIT; i++) {
      expect(l.check("ip-a", 1000, NOON + i * MIN)).toEqual({ ok: true });
    }
    const denied = l.check("ip-a", 1000, NOON + 5 * MIN);
    expect(denied).toEqual({ ok: false, code: "rate_limited", retryAfterSec: 5 * 60 });
    // Other visitors are unaffected.
    expect(l.check("ip-b", 1000, NOON + 5 * MIN)).toEqual({ ok: true });
    // Once the first one ages out of the window, one more is allowed.
    expect(l.check("ip-a", 1000, NOON + 10 * MIN + 1)).toEqual({ ok: true });
  });

  it("allows 20 per 24 hours even when spaced out", () => {
    const l = new MemoryLimiter();
    for (let i = 0; i < IP_DAILY_LIMIT; i++) {
      expect(l.check("ip-a", 1000, NOON + i * 11 * MIN).ok).toBe(true);
    }
    const at = NOON + IP_DAILY_LIMIT * 11 * MIN;
    const denied = l.check("ip-a", 1000, at);
    expect(denied).toMatchObject({ ok: false, code: "rate_limited" });
    if (!denied.ok && denied.code !== "unavailable") {
      expect(denied.retryAfterSec).toBe(Math.ceil((NOON + DAY - at) / 1000));
    }
    expect(l.check("ip-a", 1000, NOON + DAY + 1).ok).toBe(true);
  });

  it("enforces the site-wide cap per UTC day and resets at midnight", () => {
    const l = new MemoryLimiter();
    expect(l.check("a", 2, NOON).ok).toBe(true);
    expect(l.check("b", 2, NOON).ok).toBe(true);
    expect(l.check("c", 2, NOON)).toEqual({
      ok: false,
      code: "daily_cap",
      retryAfterSec: 12 * 60 * 60,
    });
    const nextDay = Date.UTC(2026, 9, 19, 0, 0, 1);
    expect(l.check("c", 2, nextDay).ok).toBe(true);
  });

  it("does not count refused requests against any limit", () => {
    const l = new MemoryLimiter();
    for (let i = 0; i < IP_SHORT_LIMIT; i++) l.check("a", 6, NOON);
    // Refused by the IP limit: must not consume site capacity.
    for (let i = 0; i < 10; i++) expect(l.check("a", 6, NOON).ok).toBe(false);
    expect(l.check("b", 6, NOON).ok).toBe(true);
    expect(l.check("c", 6, NOON).ok).toBe(false);
  });

  it("a cap of 0 pauses the site", () => {
    expect(new MemoryLimiter().check("a", 0, NOON)).toMatchObject({ ok: false, code: "daily_cap" });
  });
});

describe("MemoryLimiter.restore", () => {
  it("rebuilds both IP windows and today's site count from counted verdicts", () => {
    const l = new MemoryLimiter();
    const yesterday = NOON - 13 * 60 * MIN; // 23:00 UTC the day before
    l.restore(
      [
        { visitor: "a", at: yesterday },
        ...Array.from({ length: IP_SHORT_LIMIT }, (_, i) => ({ visitor: "a", at: NOON - (9 - i) * MIN })),
        { visitor: "b", at: NOON - 2 * MIN },
      ],
      NOON,
    );
    // Five in the last 10 minutes: "a" is refused until the oldest ages out.
    expect(l.check("a", 1000, NOON)).toEqual({ ok: false, code: "rate_limited", retryAfterSec: 60 });
    // Today already has 6 verdicts (the one yesterday does not count).
    expect(l.check("c", 7, NOON).ok).toBe(true);
    expect(l.check("d", 7, NOON)).toMatchObject({ ok: false, code: "daily_cap" });
  });
});

describe("PersistentLimiter", () => {
  it("keeps per-visitor windows across a restart", async () => {
    const url = tempDbUrl();
    const first = openLimiter(url);
    for (let i = 0; i < IP_SHORT_LIMIT; i++) {
      expect(await first.check("ip-a", 1000, NOON + i * MIN)).toEqual({ ok: true });
    }
    first.close();
    const restarted = openLimiter(url);
    expect(await restarted.check("ip-a", 1000, NOON + 5 * MIN)).toEqual({
      ok: false,
      code: "rate_limited",
      retryAfterSec: 5 * 60,
    });
    expect(await restarted.check("ip-b", 1000, NOON + 5 * MIN)).toEqual({ ok: true });
  });

  it("keeps the site-wide daily count across a restart, and resets it at UTC midnight", async () => {
    const url = tempDbUrl();
    const first = openLimiter(url);
    expect((await first.check("a", 2, NOON)).ok).toBe(true);
    expect((await first.check("b", 2, NOON)).ok).toBe(true);
    first.close();
    expect(await openLimiter(url).check("c", 2, NOON + MIN)).toMatchObject({ ok: false, code: "daily_cap" });
    const nextDay = Date.UTC(2026, 9, 19, 0, 0, 1);
    expect((await openLimiter(url).check("c", 2, nextDay)).ok).toBe(true);
  });

  it("does not store refused requests, and deletes rows older than 24 hours", async () => {
    const url = tempDbUrl();
    const l = openLimiter(url);
    expect((await l.check("a", 1, NOON)).ok).toBe(true);
    expect((await l.check("b", 1, NOON)).ok).toBe(false);
    const reader = createClient({ url });
    try {
      const count = async () => Number((await reader.execute("SELECT COUNT(*) AS n FROM rate_hits")).rows[0].n);
      expect(await count()).toBe(1);
      // A day later the old row goes when the next verdict is written.
      expect((await l.check("c", 1, NOON + DAY + MIN)).ok).toBe(true);
      expect(await count()).toBe(1);
    } finally {
      reader.close();
    }
  });
});

describe("limitDbUrl", () => {
  it("is null when unset or blank", () => {
    expect(limitDbUrl({})).toBeNull();
    expect(limitDbUrl({ RATE_LIMIT_DB: "  " })).toBeNull();
    expect(limitDbUrl({ RATE_LIMIT_DB: "file:/run/verdict/ratelimit.db" })).toBe("file:/run/verdict/ratelimit.db");
  });
});

describe("visitorKey", () => {
  it("is a keyed hash: same input and secret match, another secret does not", () => {
    const env = { RATE_LIMIT_SALT: "salt-1" };
    const key = visitorKey("203.0.113.5", env);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(visitorKey("203.0.113.5", env)).toBe(key);
    expect(visitorKey("203.0.113.6", env)).not.toBe(key);
    expect(visitorKey("203.0.113.5", { RATE_LIMIT_SALT: "salt-2" })).not.toBe(key);
    // Not the plain unsalted SHA-256 prefix, which is brute-forceable for IPv4.
    expect(visitorKey("203.0.113.5", {})).not.toBe(
      createHash("sha256").update("203.0.113.5").digest("hex").slice(0, 32),
    );
  });

  it("falls back to the Upstash token as the secret", () => {
    expect(visitorKey("203.0.113.5", { UPSTASH_REDIS_REST_TOKEN: "tok" })).toBe(
      visitorKey("203.0.113.5", { RATE_LIMIT_SALT: "tok" }),
    );
  });

  it("counts a whole IPv6 /64 as one visitor", () => {
    const env = { RATE_LIMIT_SALT: "s" };
    expect(visitorKey("2001:db8:1:2::1", env)).toBe(visitorKey("2001:db8:1:2:dead:beef::7", env));
    expect(visitorKey("2001:db8:1:2::1", env)).not.toBe(visitorKey("2001:db8:1:3::1", env));
  });
});

describe("dailyCap", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to 1000 when unset, empty, or invalid", () => {
    for (const v of [undefined, "", "abc", "-5", "2.5"]) {
      vi.stubEnv("DAILY_VERDICT_CAP", v);
      expect(dailyCap()).toBe(1000);
    }
  });

  it("reads a non-negative integer", () => {
    vi.stubEnv("DAILY_VERDICT_CAP", "250");
    expect(dailyCap()).toBe(250);
    vi.stubEnv("DAILY_VERDICT_CAP", "0");
    expect(dailyCap()).toBe(0);
  });
});

describe("checkVerdictLimits", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the in-memory store when Upstash is not configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("RATE_LIMIT_DB", "");
    const ip = "203.0.113.77";
    for (let i = 0; i < IP_SHORT_LIMIT; i++) {
      expect(await checkVerdictLimits(ip)).toEqual({ ok: true });
    }
    expect(await checkVerdictLimits(ip)).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("uses the limit database when RATE_LIMIT_DB is set", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const url = tempDbUrl();
    vi.stubEnv("RATE_LIMIT_DB", url);
    const ip = "203.0.113.78";
    for (let i = 0; i < IP_SHORT_LIMIT; i++) {
      expect(await checkVerdictLimits(ip)).toEqual({ ok: true });
    }
    expect(await checkVerdictLimits(ip)).toMatchObject({ ok: false, code: "rate_limited" });
    const reader = createClient({ url });
    try {
      expect(Number((await reader.execute("SELECT COUNT(*) AS n FROM rate_hits")).rows[0].n)).toBe(IP_SHORT_LIMIT);
    } finally {
      reader.close();
    }
  });

  it("fails closed when the limit database cannot be opened", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("RATE_LIMIT_DB", fileUrl(path.join(tmp, "missing-dir", "x.db")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await checkVerdictLimits("198.51.100.2")).toMatchObject({ ok: false, code: "unavailable" });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("fails closed when Redis is unreachable", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await checkVerdictLimits("198.51.100.1")).toMatchObject({
        ok: false,
        code: "unavailable",
      });
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
