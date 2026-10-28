import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { visitorKey } from "../lib/ratelimit";

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
