import { describe, expect, it } from "vitest";
import { clientIp, rateLimitSubject } from "../lib/client-ip";

describe("clientIp", () => {
  it("takes the first x-forwarded-for entry", () => {
    const h = new Headers({ "x-forwarded-for": " 203.0.113.5 , 10.0.0.1, 10.0.0.2" });
    expect(clientIp(h)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
    expect(clientIp(new Headers({ "x-forwarded-for": " , ", "x-real-ip": "198.51.100.9" }))).toBe(
      "198.51.100.9",
    );
  });

  it("returns unknown when no header is present", () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("keeps IPv6 addresses intact and caps absurd lengths", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(clientIp(new Headers({ "x-forwarded-for": "x".repeat(500) }))).toHaveLength(64);
  });
});

describe("rateLimitSubject", () => {
  it("leaves IPv4 and unparseable values unchanged", () => {
    expect(rateLimitSubject("203.0.113.5")).toBe("203.0.113.5");
    expect(rateLimitSubject("unknown")).toBe("unknown");
    expect(rateLimitSubject("x".repeat(64))).toBe("x".repeat(64));
  });

  it("groups IPv6 addresses by their /64 prefix", () => {
    const a = rateLimitSubject("2001:db8:1:2:aaaa::1");
    expect(a).toBe("2001:db8:1:2::/64");
    expect(rateLimitSubject("2001:0DB8:0001:0002:ffff:ffff:ffff:ffff")).toBe(a);
    expect(rateLimitSubject("[2001:db8:1:2::9]")).toBe(a);
    expect(rateLimitSubject("2001:db8:1:2::9%eth0")).toBe(a);
    expect(rateLimitSubject("2001:db8:1:3::1")).not.toBe(a);
  });

  it("expands :: wherever it falls", () => {
    expect(rateLimitSubject("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(rateLimitSubject("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitSubject("::1:2:3:4:5:6")).toBe("0:0:1:2::/64");
    expect(rateLimitSubject("64:ff9b::192.0.2.33")).toBe("64:ff9b:0:0::/64");
  });

  it("treats IPv4-mapped IPv6 as the IPv4 address", () => {
    expect(rateLimitSubject("::ffff:203.0.113.5")).toBe("203.0.113.5");
  });
});
