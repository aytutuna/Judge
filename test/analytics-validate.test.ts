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
          { name: "buy_tapped", props: { product: "com.okjudge.pack_10" } },
          { name: "settings_changed", props: { key: "lang" } },
          { name: "error_shown", props: { code: 429 } },
          { name: "sign_in_started", props: { provider: "apple" } },
        ]),
      ),
    ).toBe(true);
    expect(
      ok(
        batch([{ name: "app_open" }], {
          ...context,
          device_id: "A1B2C3D4-0000-1111-2222-333344445555",
          os_version: "18.1",
          device_model: "iPhone15.2",
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

  it("accepts only the listed event names", () => {
    expect(ok(batch([{ name: "made_up_event" }]))).toBe(false);
    expect(ok(batch([{ name: "AppOpen" }]))).toBe(false);
    expect(ok(batch([{ name: "purchase_granted" }]))).toBe(false);
    expect(ok(batch([{ name: "verdict_ready" }]))).toBe(false);
    expect(ok(batch([{ name: "sign_in" }]))).toBe(false);
  });

  it("accepts only the prop keys listed for the event", () => {
    expect(ok(batch([{ name: "app_open", props: { screen: "home" } }]))).toBe(false);
    expect(ok(batch([{ name: "screen_view", props: { product: "pack_10" } }]))).toBe(false);
    expect(ok(batch([{ name: "screen_view", props: { screen: "home", extra: 1 } }]))).toBe(false);
    expect(ok(batch([{ name: "app_open", props: {} }]))).toBe(true);
    for (const key of ["text", "body", "content", "message", "email", "name", "user_email", "error_message"]) {
      expect(ok(batch([{ name: "error_shown", props: { [key]: "x" } }])), key).toBe(false);
    }
  });

  it("accepts only tokens, bounded integers and booleans as values", () => {
    const shown = (code: unknown) => ok(batch([{ name: "error_shown", props: { code } }]));
    expect(shown("net/timeout:E42")).toBe(true);
    expect(shown(true)).toBe(true);
    expect(shown(-1_000_000)).toBe(true);
    expect(shown("two words")).toBe(false);
    expect(shown("a@example.com")).toBe(false);
    expect(shown("x".repeat(65))).toBe(false);
    expect(shown("")).toBe(false);
    expect(shown(1.5)).toBe(false);
    expect(shown(1_000_001)).toBe(false);
    expect(shown({ nested: 1 })).toBe(false);
    expect(shown(["a"])).toBe(false);
    expect(shown(null)).toBe(false);
  });

  it("checks the size of props and the batch", () => {
    expect(propsProblem("error_shown", { code: "x".repeat(64) })).toBeNull();
    expect(propsProblem("verdict_failed", { kind: "x".repeat(64), mode: "y".repeat(64), code: "z".repeat(64) })).toBeNull();
    expect(ok(batch([]))).toBe(false);
    expect(ok(batch(Array.from({ length: MAX_BATCH }, () => ({ name: "app_open" }))))).toBe(true);
    expect(ok(batch(Array.from({ length: MAX_BATCH + 1 }, () => ({ name: "app_open" }))))).toBe(false);
  });

  it("checks the context", () => {
    expect(ok(batch([{ name: "app_open" }], { ...context, platform: "server" }))).toBe(false);
    expect(ok(batch([{ name: "app_open" }], { platform: "ios" }))).toBe(false);
    expect(ok(batch([{ name: "app_open" }], { ...context, anon_id: "not-a-uuid" }))).toBe(false);
    expect(ok(batch([{ name: "app_open" }], { ...context, device_id: "short" }))).toBe(false);
    expect(ok(batch([{ name: "app_open" }], { ...context, device_model: "Pixel 8" }))).toBe(false);
    expect(ok(batch([{ name: "app_open" }], { ...context, device_model: "Pixel_8" }))).toBe(true);
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
