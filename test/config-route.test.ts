import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/v1/config/route";
import { PRICING } from "../lib/pricing";
import type { AppConfig } from "../lib/account-types";

afterEach(() => {
  vi.unstubAllEnvs();
});

const AUTH_VARS = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "APPLE_CLIENT_ID",
  "APPLE_TEAM_ID",
  "APPLE_KEY_ID",
  "APPLE_PRIVATE_KEY_BASE64",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "DEV_LOGIN",
  "PREMIUM_ENABLED",
];

function clearAuthEnv() {
  for (const k of AUTH_VARS) vi.stubEnv(k, "");
}

const call = async (host = "localhost:3600") => {
  const res = GET(new Request(`http://${host}/api/v1/config`, { headers: { host } }));
  return { res, body: (await res.json()) as AppConfig };
};

describe("GET /api/v1/config", () => {
  beforeEach(() => {
    vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "");
  });

  it("production with no auth env: every sign-in method off, premium off, pricing shown", async () => {
    clearAuthEnv();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubEnv("DEV_LOGIN", "1");
    const { res, body } = await call();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      signIn: { apple: false, google: false, email: false, dev: false },
      premiumEnabled: false,
      pricing: {
        currency: "USD",
        purchasesEnabled: false,
        packs: [
          { id: "pack_10", credits: 10, priceUsd: 1.99 },
          { id: "pack_30", credits: 30, priceUsd: 4.99 },
        ],
        monthly: { id: "monthly", priceUsd: 4.99, fairUseCap: 60, periodDays: 30 },
      },
    });
    expect(body.pricing).toEqual(PRICING);
  });

  it("production with a secret, Google and email configured", async () => {
    clearAuthEnv();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(40));
    vi.stubEnv("GOOGLE_CLIENT_ID", "web.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("RESEND_API_KEY", "re_x");
    vi.stubEnv("EMAIL_FROM", "Judge <signin@verdict.example.org>");
    const { body } = await call("verdict.example.org");
    expect(body.signIn).toEqual({ apple: false, google: true, email: true, dev: false });
    expect(body.premiumEnabled).toBe(true);
  });

  it("PREMIUM_ENABLED=0 or no model key turns premium off", async () => {
    clearAuthEnv();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(40));
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubEnv("PREMIUM_ENABLED", "0");
    expect((await call()).body.premiumEnabled).toBe(false);
    vi.stubEnv("PREMIUM_ENABLED", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect((await call()).body.premiumEnabled).toBe(false);
  });

  it("development: the test login shows only with DEV_LOGIN=1 on localhost", async () => {
    clearAuthEnv();
    vi.stubEnv("NODE_ENV", "development");
    expect((await call()).body.signIn.dev).toBe(false);
    vi.stubEnv("DEV_LOGIN", "1");
    // `next dev` without -H listens on every interface: no test login.
    vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://localhost:3600");
    expect((await call("localhost:3600")).body.signIn.dev).toBe(false);
    vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://127.0.0.1:3600");
    expect((await call("localhost:3600")).body.signIn.dev).toBe(true);
    expect((await call("192.168.1.20:3600")).body.signIn.dev).toBe(false);
  });

  it("returns a copy: callers cannot mutate the pricing config", async () => {
    const { body } = await call();
    body.pricing.packs[0].priceUsd = 0;
    expect(PRICING.packs[0].priceUsd).toBe(1.99);
  });
});
