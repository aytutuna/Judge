import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-auth-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3600";

const auth = await import("../lib/auth");
const { appleClientSecret, appleEnv } = await import("../lib/apple-secret");
const { getDb } = await import("../lib/db");
const { EMAIL_EN, langFromMagicLink, sendSignInEmail, signInEmailContent } = await import("../lib/email");
const { default: tr } = await import("../lib/locales/tr");
const SIGNIN_EMAIL = { en: EMAIL_EN.signIn, tr: tr.email.signIn };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

const req = (headers: Record<string, string> = {}, url = "http://localhost:3600/api/v1/me") =>
  new Request(url, { headers });

function appleKeyBase64(): { b64: string; publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"] } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return { b64: Buffer.from(pem).toString("base64"), publicKey };
}

describe("authConfigured / premiumEnabled", () => {
  it("production needs a real secret of at least 32 characters", () => {
    expect(auth.authConfigured({ NODE_ENV: "production" })).toBe(false);
    expect(auth.authConfigured({ NODE_ENV: "production", BETTER_AUTH_SECRET: "short" })).toBe(false);
    expect(auth.authConfigured({ NODE_ENV: "production", BETTER_AUTH_SECRET: "s".repeat(32) })).toBe(true);
  });

  it("outside production a development secret is used", () => {
    expect(auth.authConfigured({ NODE_ENV: "development" })).toBe(true);
    expect(auth.authConfigured({})).toBe(true);
  });

  it("premium needs auth and a model key, and PREMIUM_ENABLED=0 turns it off", () => {
    const prod = { NODE_ENV: "production", BETTER_AUTH_SECRET: "s".repeat(32), ANTHROPIC_API_KEY: "k" };
    expect(auth.premiumEnabled(prod)).toBe(true);
    expect(auth.premiumEnabled({ ...prod, PREMIUM_ENABLED: "0" })).toBe(false);
    expect(auth.premiumEnabled({ ...prod, ANTHROPIC_API_KEY: "" })).toBe(false);
    expect(auth.premiumEnabled({ NODE_ENV: "production", ANTHROPIC_API_KEY: "k" })).toBe(false);
  });
});

describe("authProviders", () => {
  it("everything off in production without a secret", () => {
    const env = {
      NODE_ENV: "production",
      GOOGLE_CLIENT_ID: "g",
      GOOGLE_CLIENT_SECRET: "s",
      RESEND_API_KEY: "r",
      EMAIL_FROM: "a@b.c",
      DEV_LOGIN: "1",
    };
    expect(auth.authProviders(req({ host: "localhost:3600" }), env)).toEqual({
      apple: false,
      google: false,
      email: false,
      emailCode: false,
      dev: false,
    });
  });

  it("a provider is on only with all of its credentials", () => {
    const base = { NODE_ENV: "production", BETTER_AUTH_SECRET: "s".repeat(32) };
    const r = req({ host: "verdict.example.org" });
    expect(auth.authProviders(r, base)).toEqual({
      apple: false,
      google: false,
      email: false,
      emailCode: false,
      dev: false,
    });
    expect(auth.authProviders(r, { ...base, GOOGLE_CLIENT_ID: "g" }).google).toBe(false);
    expect(auth.authProviders(r, { ...base, GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s" }).google).toBe(true);
    expect(auth.authProviders(r, { ...base, RESEND_API_KEY: "r" }).email).toBe(false);
    expect(auth.authProviders(r, { ...base, RESEND_API_KEY: "r", EMAIL_FROM: "Judge <a@b.c>" }).email).toBe(true);
    expect(auth.authProviders(r, { ...base, RESEND_API_KEY: "r" }).emailCode).toBe(false);
    expect(auth.authProviders(r, { ...base, RESEND_API_KEY: "r", EMAIL_FROM: "Judge <a@b.c>" }).emailCode).toBe(true);
  });

  it("Apple needs a usable key", () => {
    const base = {
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "s".repeat(32),
      APPLE_CLIENT_ID: "org.verdict.web",
      APPLE_TEAM_ID: "TEAM123456",
      APPLE_KEY_ID: "KEY1234567",
    };
    const r = req({ host: "verdict.example.org" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(auth.authProviders(r, base).apple).toBe(false);
    expect(auth.authProviders(r, { ...base, APPLE_PRIVATE_KEY_BASE64: Buffer.from("nope").toString("base64") }).apple).toBe(
      false,
    );
    expect(auth.authProviders(r, { ...base, APPLE_PRIVATE_KEY_BASE64: appleKeyBase64().b64 }).apple).toBe(true);
  });
});

describe("Apple client secret", () => {
  it("is an ES256 JWT with Apple's required claims, verifiable with the public key", () => {
    const { b64, publicKey } = appleKeyBase64();
    const cfg = appleEnv({
      APPLE_CLIENT_ID: "org.verdict.web",
      APPLE_TEAM_ID: "TEAM123456",
      APPLE_KEY_ID: "KEY1234567",
      APPLE_PRIVATE_KEY_BASE64: b64,
    });
    expect(cfg).not.toBeNull();
    const now = new Date("2026-10-19T12:00:00Z");
    const { jwt, issuedAtMs } = appleClientSecret(cfg!, now);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1234567", typ: "JWT" });
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload).toMatchObject({ iss: "TEAM123456", sub: "org.verdict.web", aud: "https://appleid.apple.com" });
    expect(payload.iat * 1000).toBe(issuedAtMs);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(15_777_000);
    const ok = verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });

  it("errors never contain the key", () => {
    const secret = Buffer.from("-----BEGIN PRIVATE KEY-----\nTOPSECRET\n-----END PRIVATE KEY-----").toString("base64");
    const cfg = { teamId: "T", keyId: "K", clientId: "C", privateKeyBase64: secret };
    expect(() => appleClientSecret(cfg)).toThrow(/could not be parsed/);
    try {
      appleClientSecret(cfg);
    } catch (e) {
      expect(String(e)).not.toContain("TOPSECRET");
      expect(String(e)).not.toContain(secret);
    }
  });
});

describe("isSameOrigin", () => {
  it("accepts the configured origin or the request's own host", () => {
    expect(auth.isSameOrigin(req({ origin: "http://localhost:3600", host: "localhost:3600" }))).toBe(true);
    expect(auth.isSameOrigin(req({ origin: "http://localhost:3600", host: "10.0.0.5:3000" }))).toBe(true);
    expect(auth.isSameOrigin(req({ origin: "https://verdict.example.org", host: "verdict.example.org" }))).toBe(true);
    expect(auth.isSameOrigin(req({ referer: "http://localhost:3600/account", host: "localhost:3600" }))).toBe(true);
  });

  it("refuses foreign, missing and opaque origins", () => {
    expect(auth.isSameOrigin(req({ origin: "https://evil.example", host: "localhost:3600" }))).toBe(false);
    expect(auth.isSameOrigin(req({ host: "localhost:3600" }))).toBe(false);
    expect(auth.isSameOrigin(req({ origin: "null", host: "localhost:3600" }))).toBe(false);
    expect(auth.isSameOrigin(req({ referer: "https://evil.example/x", host: "localhost:3600" }))).toBe(false);
    expect(auth.isSameOrigin(req({ origin: "http://localhost:3600.evil.example", host: "localhost:3600" }))).toBe(false);
  });
});

describe("Better Auth on the shared libSQL database", () => {
  it("creates its tables next to the existing ones", async () => {
    await auth.authReady();
    const db = await getDb();
    const rs = await db.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
    const tables = rs.rows.map((r) => String(r.name));
    for (const t of ["user", "session", "account", "verification", "verdicts", "entitlement_grants", "premium_usage"]) {
      expect(tables).toContain(t);
    }
  });

  it("resolves a session by bearer token and by signed cookie, and never stores IP or device", async () => {
    const { token, user } = await auth.createDevSession("viewer@verdict.local");
    const viaBearer = await auth.getViewer(req({ authorization: `Bearer ${token}` }));
    expect(viaBearer).toMatchObject({ via: "bearer", user: { id: user.id, email: "viewer@verdict.local" } });

    const cookie = (await auth.sessionCookieHeader(token)).split(";")[0];
    expect(cookie.startsWith("verdict.session_token=")).toBe(true);
    const viaCookie = await auth.getViewer(req({ cookie }));
    expect(viaCookie).toMatchObject({ via: "cookie", user: { id: user.id } });

    expect(await auth.getViewer(req({ authorization: "Bearer not-a-session" }))).toBeNull();
    expect(await auth.getViewer(req())).toBeNull();

    const db = await getDb();
    const rows = await db.execute({ sql: "SELECT ipAddress, userAgent FROM session WHERE userId = ?", args: [user.id] });
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const r of rows.rows) expect([r.ipAddress, r.userAgent]).toEqual([null, null]);
  });

  it("serves get-session over HTTP for a bearer token (the app path)", async () => {
    const { token } = await auth.createDevSession("http@verdict.local");
    const instance = await auth.getAuth();
    const res = await instance.handler(
      new Request("http://localhost:3600/api/auth/get-session", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(res.status).toBe(200);
    expect((await res.json())?.user?.email).toBe("http@verdict.local");
  });

  it("getViewer never throws: a broken lookup is logged and treated as signed out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const instance = await auth.getAuth();
    vi.spyOn(instance.api, "getSession").mockRejectedValueOnce(new Error("db down"));
    expect(await auth.getViewer(req({ authorization: "Bearer x" }))).toBeNull();
  });

  it("emails a magic link (language from callbackURL) whose link signs the user in", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Judge <signin@verdict.example.org>");
    const sent: { to: string[]; subject: string; text: string }[] = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "https://api.resend.com/emails") {
          sent.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify({ id: "x" }), { status: 200 });
        }
        return realFetch(input, init);
      }),
    );
    const log = vi.spyOn(console, "log");
    const instance = await auth.getAuth();
    const res = await instance.handler(
      new Request("http://localhost:3600/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3600" },
        body: JSON.stringify({ email: "Reader@Example.com", callbackURL: "/account?lang=tr" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to.map((a) => a.toLowerCase())).toEqual(["reader@example.com"]);
    expect(sent[0].subject).toBe(SIGNIN_EMAIL.tr.subject);
    const link = /https?:\/\/\S+/.exec(sent[0].text)![0];
    expect(link.startsWith("http://localhost:3600/api/auth/magic-link/verify?")).toBe(true);
    expect(log.mock.calls.flat().join(" ").toLowerCase()).not.toContain("reader@example.com");

    const verify = await instance.handler(new Request(link, { headers: { origin: "http://localhost:3600" } }));
    expect(verify.status).toBe(302);
    expect(verify.headers.get("location")).toContain("/account?lang=tr");
    const token = verify.headers.get("set-auth-token");
    expect(token).toBeTruthy();
    const viewer = await auth.getViewer(req({ authorization: `Bearer ${token}` }));
    expect(viewer?.user.email.toLowerCase()).toBe("reader@example.com");
  });

  it("the magic-link endpoint does not exist without email credentials", async () => {
    const instance = await auth.getAuth();
    const res = await instance.handler(
      new Request("http://localhost:3600/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3600" },
        body: JSON.stringify({ email: "a@example.com" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("sign-in email", () => {
  it("picks the language from the callbackURL's lang param", () => {
    const link = (cb: string) =>
      `https://v.example/api/auth/magic-link/verify?token=t&callbackURL=${encodeURIComponent(cb)}`;
    expect(langFromMagicLink(link("/account?lang=tr"))).toBe("tr");
    expect(langFromMagicLink(link("/account?lang=en"))).toBe("en");
    expect(langFromMagicLink(link("/account"))).toBe("en");
    expect(langFromMagicLink("not a url")).toBe("en");
  });

  it("Turkish copy speaks as informal sen", () => {
    const formal = /(?:[ıiuü]n[ıiuü]z|s[ıiuü]n[ıiuü]z|\bsiz(?:in|e|i|den)?\b)/iu;
    for (const [key, value] of Object.entries(SIGNIN_EMAIL.tr)) expect(value, key).not.toMatch(formal);
    expect(Object.keys(SIGNIN_EMAIL.tr)).toEqual(Object.keys(SIGNIN_EMAIL.en));
  });

  it("escapes the link in HTML and keeps it intact in text", () => {
    const url = 'https://v.example/verify?token=a&b="<x>"';
    const { html, text } = signInEmailContent(url, "en");
    expect(text).toContain(url);
    expect(html).not.toContain('"<x>"');
    expect(html).toContain("&quot;&lt;x&gt;&quot;");
  });

  it("send errors carry no address or link", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Judge <a@b.c>");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 422 })));
    const err = await sendSignInEmail({ to: "secret@person.com", url: "https://x/verify?token=SECRET", lang: "en" }).catch(
      (e: unknown) => e,
    );
    expect(String(err)).toContain("HTTP 422");
    expect(String(err)).not.toContain("secret@person.com");
    expect(String(err)).not.toContain("SECRET");
  });
});
