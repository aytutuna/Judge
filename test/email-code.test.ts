import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-email-code-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3600";

const auth = await import("../lib/auth");
const { EMAIL_EN, langFromRequestUrl, sendSignInCodeEmail, signInCodeEmailContent } = await import("../lib/email");
const { default: tr } = await import("../lib/locales/tr");
const SIGNIN_CODE_EMAIL = { en: EMAIL_EN.signInCode, tr: tr.email.signInCode };
const { GET: getMe } = await import("../app/api/v1/me/route");
const { GET: getConfig } = await import("../app/api/v1/config/route");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const ORIGIN = "http://localhost:3600";
type Sent = { to: string[]; subject: string; text: string; html: string };

/** Turns email on and captures what would go to Resend. */
function emailOn(): Sent[] {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Judge <signin@verdict.example.org>");
  const sent: Sent[] = [];
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
  return sent;
}

/** A native-app style request: JSON, no cookies, no Origin header. */
async function post(pathAndQuery: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const instance = await auth.getAuth();
  return instance.handler(
    new Request(`${ORIGIN}/api/auth${pathAndQuery}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const sendCode = (email: string, query = "", body: Record<string, unknown> = {}) =>
  post(`/email-otp/send-verification-otp${query}`, { email, type: "sign-in", ...body });

const signIn = (email: string, otp: string) => post("/sign-in/email-otp", { email, otp });

function codeFrom(mail: Sent): string {
  const m = /\b(\d{6})\b/.exec(mail.text);
  if (!m) throw new Error("no code in the email");
  return m[1];
}

/** A 6-digit code that is not `code`. */
const wrong = (code: string) => (code === "000000" ? "111111" : "000000");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("email sign-in by code (apps)", () => {
  beforeEach(() => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  });

  it("send, then sign in with the code: the body token works as a Bearer on /api/v1/me", async () => {
    const sent = emailOn();
    const log = vi.spyOn(console, "log");
    const res = await sendCode("Coder@Example.com");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["coder@example.com"]);
    expect(sent[0].subject).toBe(SIGNIN_CODE_EMAIL.en.subject);
    const code = codeFrom(sent[0]);
    expect(sent[0].html).toContain(code);
    expect(log.mock.calls.flat().join(" ")).not.toContain(code);

    const signed = await signIn("coder@example.com", code);
    expect(signed.status).toBe(200);
    const body = (await signed.json()) as { token: string; user: { email: string; emailVerified: boolean } };
    expect(body.token).toBeTruthy();
    expect(body.user).toMatchObject({ email: "coder@example.com", emailVerified: true });
    // The header carries the signed form "<token>.<signature>"; either works as a Bearer.
    const header = signed.headers.get("set-auth-token");
    expect(header?.split(".")[0]).toBe(body.token);

    for (const bearer of [body.token, header!]) {
      const me = await getMe(new Request(`${ORIGIN}/api/v1/me`, { headers: { authorization: `Bearer ${bearer}` } }));
      expect(me.status).toBe(200);
      expect(((await me.json()) as { user: { email: string } }).user.email).toBe("coder@example.com");
    }

    // Single use.
    expect((await signIn("coder@example.com", code)).status).toBe(400);
  });

  it("signs an existing user into the same account", async () => {
    const sent = emailOn();
    await sendCode("again@example.com");
    const first = (await (await signIn("again@example.com", codeFrom(sent[0]))).json()) as { user: { id: string } };
    await sendCode("again@example.com");
    const second = (await (await signIn("again@example.com", codeFrom(sent[1]))).json()) as { user: { id: string } };
    expect(second.user.id).toBe(first.user.id);
  });

  it("emails Turkish copy for ?lang=tr and English otherwise", async () => {
    const sent = emailOn();
    expect((await sendCode("tr@example.com", "?lang=tr")).status).toBe(200);
    expect((await sendCode("en@example.com", "?lang=xx")).status).toBe(200);
    expect(sent.map((m) => m.subject)).toEqual([SIGNIN_CODE_EMAIL.tr.subject, SIGNIN_CODE_EMAIL.en.subject]);
  });

  it("a wrong code fails and the right one still works afterwards", async () => {
    const sent = emailOn();
    await sendCode("typo@example.com");
    const code = codeFrom(sent[0]);
    const bad = await signIn("typo@example.com", wrong(code));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe("INVALID_OTP");
    expect(bad.headers.get("set-auth-token")).toBeNull();
    expect((await signIn("typo@example.com", code)).status).toBe(200);
  });

  it("after three wrong codes the code is burned, even the right one", async () => {
    const sent = emailOn();
    await sendCode("guess@example.com");
    const code = codeFrom(sent[0]);
    for (let i = 0; i < 3; i++) expect((await signIn("guess@example.com", wrong(code))).status).toBe(400);
    const locked = await signIn("guess@example.com", code);
    expect(locked.status).toBe(403);
    expect(((await locked.json()) as { code: string }).code).toBe("TOO_MANY_ATTEMPTS");
    expect((await signIn("guess@example.com", code)).status).toBe(400);
  });

  it("a code older than 10 minutes is expired", async () => {
    const sent = emailOn();
    await sendCode("late@example.com");
    const code = codeFrom(sent[0]);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10 * 60_000 + 5_000);
    const res = await signIn("late@example.com", code);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("OTP_EXPIRED");
  });

  it("a code that was never sent, or for another address, fails", async () => {
    const sent = emailOn();
    expect((await signIn("nobody@example.com", "123456")).status).toBe(400);
    await sendCode("owner@example.com");
    expect((await signIn("intruder@example.com", codeFrom(sent[0]))).status).toBe(400);
  });

  it("only sign-in codes can be requested", async () => {
    const sent = emailOn();
    for (const type of ["email-verification", "forget-password", "change-email", undefined]) {
      const res = await post("/email-otp/send-verification-otp", { email: "again@example.com", type });
      expect(res.status, String(type)).toBe(400);
    }
    expect(sent).toHaveLength(0);
  });

  it("rejects an invalid address without sending", async () => {
    const sent = emailOn();
    expect((await sendCode("not-an-email")).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("needs no captcha even when Turnstile guards the magic link", async () => {
    const sent = emailOn();
    vi.stubEnv("TURNSTILE_SECRET_KEY", "0x4AAAAAAAtest");
    expect((await sendCode("nocaptcha@example.com")).status).toBe(200);
    expect((await signIn("nocaptcha@example.com", codeFrom(sent[0]))).status).toBe(200);
    // The magic link still requires the widget's token.
    const magic = await post(
      "/sign-in/magic-link",
      { email: "nocaptcha@example.com", callbackURL: "/account" },
      { origin: ORIGIN },
    );
    expect(magic.status).toBe(400);
    expect(((await magic.json()) as { code: string }).code).toBe("MISSING_RESPONSE");
  });

  it("the plugin's other endpoints stay closed", async () => {
    emailOn();
    for (const p of [
      "/email-otp/check-verification-otp",
      "/email-otp/verify-email",
      "/email-otp/request-password-reset",
      "/forget-password/email-otp",
      "/email-otp/reset-password",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
      "/sign-in/email",
      "/sign-up/email",
    ]) {
      expect((await post(p, { email: "a@example.com", otp: "123456", type: "sign-in" })).status, p).toBe(404);
    }
  });

  it("is rate limited to 3 requests per minute per IP in production", async () => {
    const sent = emailOn();
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ip = { "x-forwarded-for": "203.0.113.7" };
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await post("/email-otp/send-verification-otp", { email: "limit@example.com", type: "sign-in" }, ip);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses[3]).toBe(429);
    expect(sent).toHaveLength(3);
    // Sign-in attempts have their own bucket with the same limit.
    const tries: number[] = [];
    for (let i = 0; i < 4; i++) tries.push((await post("/sign-in/email-otp", { email: "x@example.com", otp: "1" }, ip)).status);
    expect(tries.slice(0, 3).every((s) => s === 400)).toBe(true);
    expect(tries[3]).toBe(429);
  });

  it("without email credentials both endpoints are absent and the config flag is off", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    expect((await sendCode("a@example.com")).status).toBe(404);
    expect((await signIn("a@example.com", "123456")).status).toBe(404);
    const cfg = await (await getConfig(new Request(`${ORIGIN}/api/v1/config`, { headers: { host: "localhost:3600" } }))).json();
    expect(cfg.signIn).toMatchObject({ email: false, emailCode: false });
  });

  it("the config flag is on when email is configured", async () => {
    emailOn();
    const cfg = await (await getConfig(new Request(`${ORIGIN}/api/v1/config`, { headers: { host: "localhost:3600" } }))).json();
    expect(cfg.signIn).toMatchObject({ email: true, emailCode: true });
  });
});

describe("sign-in code email", () => {
  it("reads the language from the request URL", () => {
    expect(langFromRequestUrl(`${ORIGIN}/api/auth/email-otp/send-verification-otp?lang=tr`)).toBe("tr");
    expect(langFromRequestUrl(`${ORIGIN}/api/auth/email-otp/send-verification-otp?lang=en`)).toBe("en");
    expect(langFromRequestUrl(`${ORIGIN}/api/auth/email-otp/send-verification-otp`)).toBe("en");
    expect(langFromRequestUrl(undefined)).toBe("en");
  });

  it("Turkish copy speaks as informal sen, with the same keys as English", () => {
    const formal = /(?:[ıiuü]n[ıiuü]z|s[ıiuü]n[ıiuü]z|\bsiz(?:in|e|i|den)?\b)/iu;
    for (const [key, value] of Object.entries(SIGNIN_CODE_EMAIL.tr)) expect(value, key).not.toMatch(formal);
    expect(Object.keys(SIGNIN_CODE_EMAIL.tr)).toEqual(Object.keys(SIGNIN_CODE_EMAIL.en));
  });

  it("puts the code in text and HTML but not in the subject", () => {
    const { subject, text, html } = signInCodeEmailContent("482913", "en");
    expect(text).toContain("482913");
    expect(html).toContain("482913");
    expect(subject).not.toContain("482913");
  });

  it("send errors carry no address or code", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Judge <a@b.c>");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 422 })));
    const err = await sendSignInCodeEmail({ to: "secret@person.com", code: "482913", lang: "en" }).catch(
      (e: unknown) => e,
    );
    expect(String(err)).toContain("HTTP 422");
    expect(String(err)).not.toContain("secret@person.com");
    expect(String(err)).not.toContain("482913");
  });
});
