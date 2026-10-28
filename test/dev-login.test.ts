import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-devlogin-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");

const { devLoginAllowed, authProviders } = await import("../lib/auth");
const route = await import("../app/api/v1/auth/dev-login/route");
const me = await import("../app/api/v1/me/route");

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

/** Next records the address it listens on: `next dev -H 127.0.0.1`. */
const LOOPBACK = "http://127.0.0.1:3600";
const DEV = { NODE_ENV: "development", DEV_LOGIN: "1", __NEXT_PRIVATE_ORIGIN: LOOPBACK };
const at = (host: string, extra: Record<string, string> = {}) =>
  new Request("http://localhost:3600/api/v1/auth/dev-login", { method: "POST", headers: { host, ...extra } });

describe("devLoginAllowed: all four guards", () => {
  it("allows a localhost host header under development with DEV_LOGIN=1", () => {
    for (const host of ["localhost:3600", "localhost", "LOCALHOST:3699", "127.0.0.1:3601", "[::1]:3600", "[::1]"]) {
      expect(devLoginAllowed(at(host), DEV), host).toBe(true);
    }
  });

  it("never in production, whatever else is set", () => {
    expect(devLoginAllowed(at("localhost:3600"), { ...DEV, NODE_ENV: "production" })).toBe(false);
    expect(devLoginAllowed(at("127.0.0.1:3600"), { NODE_ENV: "production", DEV_LOGIN: "1" })).toBe(false);
  });

  it("needs DEV_LOGIN to be exactly 1", () => {
    for (const value of [undefined, "", "0", "true", "yes", " 1", "11"]) {
      expect(devLoginAllowed(at("localhost:3600"), { ...DEV, DEV_LOGIN: value }), String(value)).toBe(false);
    }
  });

  it("refuses any non-local Host, and ignores X-Forwarded-Host", () => {
    for (const host of [
      "example.com",
      "verdict.example.org",
      "localhost.evil.com",
      "evil.com:3600",
      "127.0.0.2:3600",
      "10.0.0.1:3600",
      "0.0.0.0:3600",
      "localhost:3600.evil.com",
    ]) {
      expect(devLoginAllowed(at(host), DEV), host).toBe(false);
    }
    expect(devLoginAllowed(at("example.com", { "x-forwarded-host": "localhost:3600" }), DEV)).toBe(false);
    expect(devLoginAllowed(new Request("http://localhost:3600/x"), DEV)).toBe(false); // no Host header
  });

  it("needs the server to listen on loopback only (next dev -H 127.0.0.1 or -H ::1)", () => {
    expect(devLoginAllowed(at("localhost:3600"), { ...DEV, __NEXT_PRIVATE_ORIGIN: "http://[::1]:3600" })).toBe(true);
    // Without -H Next listens on every interface and records "localhost":
    // a LAN client could send "Host: localhost" and get in.
    for (const origin of [
      undefined,
      "",
      "http://localhost:3600",
      "http://0.0.0.0:3600",
      "http://192.168.2.45:3600",
      "http://127.0.0.2:3600",
      "not a url",
    ]) {
      expect(devLoginAllowed(at("localhost:3600"), { ...DEV, __NEXT_PRIVATE_ORIGIN: origin }), String(origin)).toBe(
        false,
      );
    }
  });

  it("authProviders reports dev only when allowed", () => {
    expect(authProviders(at("localhost:3600"), DEV).dev).toBe(true);
    expect(authProviders(at("localhost:3600"), { ...DEV, NODE_ENV: "production" }).dev).toBe(false);
  });

  it("the guard reads process.env by default", () => {
    vi.stubEnv("DEV_LOGIN", "1");
    vi.stubEnv("__NEXT_PRIVATE_ORIGIN", LOOPBACK);
    vi.stubEnv("NODE_ENV", "production");
    expect(devLoginAllowed(at("localhost:3600"))).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(devLoginAllowed(at("localhost:3600"))).toBe(true);
  });
});

describe("POST /api/v1/auth/dev-login", () => {
  beforeEach(() => {
    vi.stubEnv("__NEXT_PRIVATE_ORIGIN", LOOPBACK);
  });

  const post = (host: string, body?: unknown, headers: Record<string, string> = {}) =>
    route.POST(
      new Request(`http://${host}/api/v1/auth/dev-login`, {
        method: "POST",
        headers: { host, "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  it("is a 404 in production even with DEV_LOGIN=1 on localhost", async () => {
    vi.stubEnv("DEV_LOGIN", "1");
    vi.stubEnv("NODE_ENV", "production");
    const res = await post("localhost:3600");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("is a 404 without DEV_LOGIN, and for a forged host", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await post("localhost:3600")).status).toBe(404);
    vi.stubEnv("DEV_LOGIN", "1");
    expect((await post("example.com")).status).toBe(404);
    expect((await post("example.com", {}, { "x-forwarded-host": "localhost:3600" })).status).toBe(404);
    expect((await post("localhost:3600", {}, { origin: "https://evil.example" })).status).toBe(404);
  });

  it("is a 404 for a forged localhost Host when the server listens on every interface", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LOGIN", "1");
    vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://localhost:3600");
    const res = await post("localhost:3600");
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("GET is a 404 too", () => {
    expect(route.GET().status).toBe(404);
  });

  it("signs in the test user: token works as a bearer, cookie is set", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LOGIN", "1");
    const res = await post("localhost:3600", undefined, { origin: "http://localhost:3600" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user: { email: string; name: string } };
    expect(body.user).toMatchObject({ email: "test@verdict.local", name: "Test user" });
    expect(body.token).toMatch(/^\S{16,}$/);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^verdict\.session_token=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);

    const viaBearer = await me.GET(
      new Request("http://localhost:3600/api/v1/me", { headers: { authorization: `Bearer ${body.token}` } }),
    );
    expect(await viaBearer.json()).toMatchObject({
      user: { email: "test@verdict.local" },
      entitlement: { canUsePremium: true, blockedReason: null, credits: 1 },
    });
    const viaCookie = await me.GET(
      new Request("http://localhost:3600/api/v1/me", { headers: { cookie: cookie.split(";")[0] } }),
    );
    expect(await viaCookie.json()).toMatchObject({ user: { email: "test@verdict.local" } });
  });

  it("reuses the same user for the same email, and only accepts @verdict.local", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LOGIN", "1");
    const a = (await (await post("127.0.0.1:3600", { email: "tester2@verdict.local" })).json()) as { user: { id: string } };
    const b = (await (await post("127.0.0.1:3600", { email: "Tester2@verdict.local" })).json()) as { user: { id: string } };
    expect(a.user.id).toBe(b.user.id);
    const bad = await post("localhost:3600", { email: "someone@gmail.com" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "invalid" });
  });
});
