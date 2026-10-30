import { describe, expect, it } from "vitest";
import { countryOf, EventBatch, MAX_BATCH, propsProblem } from "../lib/analytics/validate";

const context = { platform: "ios", app_version: "1.4.0", anon_id: "6f1c1b7e-2a0d-4c4e-9a63-0c4c2c1f9b10" };
const batch = (events: unknown[], ctx: Record<string, unknown> = context) => ({ context: ctx, events });
const ok = (body: unknown) => EventBatch.safeParse(body).success;

describe("EventBatch", () => {
  it("accepts the documented shape", () => {
    expect(
      ok(
        batch([
          { name: "app_open" },
          { name: "screen_view", at: Date.now(), props: { screen: "home" } },
          { name: "buy_tapped", props: { product: "pack_10", price_shown: 4.99, first_time: true } },
        ]),
      ),
    ).toBe(true);
    expect(
      ok(
        batch([{ name: "app_open" }], {
          ...context,
          device_id: "A1B2C3D4-0000-1111-2222-333344445555",
          os_version: "18.1",
          device_model: "iPhone15,2",
          locale: "tr-TR",
        }),
      ),
    ).toBe(true);
    // Nulls for the optional fields, as some JSON encoders send them.
    expect(ok(batch([{ name: "app_open", at: null, props: null }], { ...context, locale: null }))).toBe(true);
  });

  it("rejects unknown fields at every level", () => {
    expect(ok({ ...batch([{ name: "app_open" }]), extra: 1 })).toBe(false);
    expect(ok(batch([{ name: "app_open" }], { ...context, ip: "203.0.113.7" }))).toBe(false);
    expect(ok(batch([{ name: "app_open" }], { ...context, user_agent: "x" }))).toBe(false);
    expect(ok(batch([{ name: "app_open", user_id: "u1" }]))).toBe(false);
  });

  it("rejects forbidden prop keys, also inside snake_case keys", () => {
    for (const key of ["text", "body", "content", "message", "email", "name", "user_email", "first_name", "error_message"]) {
      expect(ok(batch([{ name: "error_shown", props: { [key]: "x" } }])), key).toBe(false);
    }
    expect(ok(batch([{ name: "error_shown", props: { code: "E42", names_visible: true } }]))).toBe(true);
  });

  it("rejects email-like and long strings, nested values and bad keys", () => {
    expect(ok(batch([{ name: "settings_changed", props: { key: "a@example.com" } }]))).toBe(false);
    expect(ok(batch([{ name: "settings_changed", props: { key: "x".repeat(101) } }]))).toBe(false);
    expect(ok(batch([{ name: "settings_changed", props: { key: { nested: 1 } } }]))).toBe(false);
    expect(ok(batch([{ name: "settings_changed", props: { key: ["a"] } }]))).toBe(false);
    expect(ok(batch([{ name: "settings_changed", props: { Key: "a" } }]))).toBe(false);
    expect(ok(batch([{ name: "settings_changed", props: { key: null } }]))).toBe(false);
  });

  it("rejects props over 2 KB", () => {
    const props = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, "v".repeat(90)]));
    expect(propsProblem(props)).toBe("props too large");
    expect(ok(batch([{ name: "screen_view", props }]))).toBe(false);
  });

  it("rejects bad names, server-only names and batch sizes", () => {
    expect(ok(batch([{ name: "AppOpen" }]))).toBe(false);
    expect(ok(batch([{ name: "app open" }]))).toBe(false);
    expect(ok(batch([{ name: "a".repeat(65) }]))).toBe(false);
    expect(ok(batch([{ name: "purchase_granted" }]))).toBe(false);
    expect(ok(batch([{ name: "verdict_ready" }]))).toBe(false);
    expect(ok(batch([]))).toBe(false);
    expect(ok(batch(Array.from({ length: MAX_BATCH }, () => ({ name: "app_open" }))))).toBe(true);
    expect(ok(batch(Array.from({ length: MAX_BATCH + 1 }, () => ({ name: "app_open" }))))).toBe(false);
  });

  it("checks the context", () => {
    expect(ok(batch([{ name: "app_open" }], { ...context, platform: "server" }))).toBe(false);
    expect(ok(batch([{ name: "app_open" }], { platform: "ios" }))).toBe(false);
    expect(ok(batch([{ name: "app_open" }], { ...context, anon_id: "not-a-uuid" }))).toBe(false);
    expect(ok(batch([{ name: "app_open" }], { ...context, device_id: "short" }))).toBe(false);
    expect(ok(batch([{ name: "app_open" }], { ...context, locale: "Turkish please" }))).toBe(false);
  });
});

describe("countryOf", () => {
  const headers = (code: string) => new Headers({ "cf-ipcountry": code });

  it("reads CF-IPCountry only behind Cloudflare's proxy", () => {
    expect(countryOf(headers("TR"), { CLOUDFLARE_PROXY: "1" })).toBe("TR");
    expect(countryOf(headers("de"), { CLOUDFLARE_PROXY: "1" })).toBe("DE");
    expect(countryOf(headers("TR"), {})).toBeNull();
    expect(countryOf(headers("TR"), { CLOUDFLARE_PROXY: "0" })).toBeNull();
  });

  it("drops unknown and Tor codes", () => {
    expect(countryOf(headers("XX"), { CLOUDFLARE_PROXY: "1" })).toBeNull();
    expect(countryOf(headers("T1"), { CLOUDFLARE_PROXY: "1" })).toBeNull();
    expect(countryOf(new Headers(), { CLOUDFLARE_PROXY: "1" })).toBeNull();
  });
});
