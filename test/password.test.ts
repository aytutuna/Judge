import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-password-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3600";

const auth = await import("../lib/auth");
const { getDb } = await import("../lib/db");
const { POST: postPassword } = await import("../app/api/v1/me/password/route");
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
type Sent = { to: string[]; text: string };

let resendStatus = 200;

/** Turns email on and captures what would go to Resend; `resendStatus` makes it refuse. */
function emailOn(): Sent[] {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Judge <signin@verdict.example.org>");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  const sent: Sent[] = [];
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "https://api.resend.com/emails") {
        if (resendStatus !== 200) return new Response("down", { status: resendStatus });
        sent.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: "x" }), { status: 200 });
      }
      return realFetch(input, init);
    }),
  );
  return sent;
}

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

const codeFrom = (mail: Sent) => /\b(\d{6})\b/.exec(mail.text)![1];
const sendCode = (email: string) => post("/email-otp/send-verification-otp", { email, type: "sign-in" });
const signInPassword = (email: string, password: string, headers: Record<string, string> = {}) =>
  post("/sign-in/email", { email, password }, headers);

/** Code sign-in as the apps do it; returns the bearer token. */
async function codeSignIn(sent: Sent[], email: string): Promise<string> {
  const before = sent.length;
  expect((await sendCode(email)).status).toBe(200);
  expect(sent).toHaveLength(before + 1);
  const res = await post("/sign-in/email-otp", { email, otp: codeFrom(sent[before]) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

const setPassword = (token: string, body: unknown) =>
  postPassword(
    new Request(`${ORIGIN}/api/v1/me/password`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const me = (token: string) =>
  getMe(new Request(`${ORIGIN}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } }));

const config = async () =>
  (await getConfig(new Request(`${ORIGIN}/api/v1/config`, { headers: { host: "localhost:3600" } }))).json();

/** Moves a session's creation back, so it no longer counts as a recent sign-in. */
async function age(token: string, minutes: number) {
  const db = await getDb();
  await db.execute({
    sql: "UPDATE session SET createdAt = ? WHERE token = ?",
    args: [new Date(Date.now() - minutes * 60_000).toISOString(), token],
  });
}

beforeEach(() => {
  resendStatus = 200;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("password sign-in", () => {
  it("code sign-in, set a password, then sign in with it", async () => {
    const sent = emailOn();
    const token = await codeSignIn(sent, "pw1@example.com");
    const set = await setPassword(token, { password: "correct horse" });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ ok: true });

    const res = await signInPassword("PW1@example.com", "correct horse");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user: { email: string } };
    expect(body.user.email).toBe("pw1@example.com");
    expect(res.headers.get("set-auth-token")?.split(".")[0]).toBe(body.token);
    expect((await me(body.token)).status).toBe(200);
    expect(((await (await me(body.token)).json()) as { hasPassword: boolean }).hasPassword).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("answers the same for an unknown address, a wrong password and an account without one", async () => {
    const sent = emailOn();
    await setPassword(await codeSignIn(sent, "known@example.com"), { password: "correct horse" });
    await codeSignIn(sent, "nopass@example.com");

    const seen = [];
    for (const email of ["known@example.com", "nobody@example.com", "nopass@example.com"]) {
      const res = await signInPassword(email, "wrong password");
      seen.push({ status: res.status, body: await res.json(), token: res.headers.get("set-auth-token") });
    }
    expect(seen[0].status).toBe(401);
    expect(seen[0].token).toBeNull();
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[2]).toEqual(seen[0]);
  });

  it("never creates accounts: /sign-up/email stays refused", async () => {
    emailOn();
    const res = await post("/sign-up/email", { email: "new@example.com", password: "correct horse", name: "x" });
    expect(res.status).toBe(404);
    const db = await getDb();
    const rs = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM "user" WHERE email = ?', args: ["new@example.com"] });
    expect(Number(rs.rows[0].n)).toBe(0);
    expect((await signInPassword("new@example.com", "correct horse")).status).toBe(401);
  });

  it("the reset and change endpoints stay closed", async () => {
    emailOn();
    for (const p of ["/request-password-reset", "/reset-password", "/change-password"]) {
      expect((await post(p, { newPassword: "correct horse", email: "a@example.com" })).status, p).toBe(404);
    }
  });

  it("keeps the session, account and password-check routes closed", async () => {
    const sent = emailOn();
    const token = await codeSignIn(sent, "closed@example.com");
    await setPassword(token, { password: "correct horse" });
    const bearer = { authorization: `Bearer ${token}` };
    for (const p of [
      "/unlink-account",
      "/list-accounts",
      "/list-sessions",
      "/revoke-session",
      "/revoke-sessions",
      "/revoke-other-sessions",
      "/update-session",
      "/verify-password",
      "/delete-user",
    ]) {
      expect((await post(p, { password: "correct horse", accountId: "x", token: "x" }, bearer)).status, p).toBe(404);
    }
    const list = await (await auth.getAuth()).handler(
      new Request(`${ORIGIN}/api/auth/list-sessions`, { headers: bearer }),
    );
    expect(list.status).toBe(404);
  });

  it("is off without email credentials", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    expect((await signInPassword("a@example.com", "correct horse")).status).toBe(400);
    expect((await config()).signIn.password).toBe(false);
  });

  it("the config reports password along with the email code", async () => {
    emailOn();
    expect((await config()).signIn).toMatchObject({ emailCode: true, password: true });
  });

  it("limits attempts per address, whether or not it exists", async () => {
    emailOn();
    for (const email of ["ghost@example.com", "ghost2@example.com"]) {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push((await signInPassword(email, "wrong password")).status);
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    }
  });

  it("counts attempts per address and IP, so one visitor cannot lock the address for everyone", async () => {
    emailOn();
    const from = (n: number) => ({ "x-forwarded-for": `198.51.100.${n}` });
    for (let i = 0; i < 10; i++) await signInPassword("target@example.com", "wrong password", from(1));
    expect((await signInPassword("target@example.com", "wrong password", from(1))).status).toBe(429);
    expect((await signInPassword("target@example.com", "wrong password", from(2))).status).toBe(401);
  });

  it("is rate limited per IP in production", async () => {
    emailOn();
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ip = { "x-forwarded-for": "203.0.113.9" };
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await signInPassword(`ip${i}@example.com`, "wrong password", ip)).status);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe("POST /api/v1/me/password", () => {
  it("needs a live session", async () => {
    emailOn();
    const res = await postPassword(
      new Request(`${ORIGIN}/api/v1/me/password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "correct horse" }),
      }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("signin_required");
    expect((await setPassword("not-a-session", { password: "correct horse" })).status).toBe(401);
  });

  it("refuses a cookie request from another origin", async () => {
    const sent = emailOn();
    const token = await codeSignIn(sent, "csrf@example.com");
    const cookie = await auth.sessionCookieHeader(token);
    const res = await postPassword(
      new Request(`${ORIGIN}/api/v1/me/password`, {
        method: "POST",
        headers: { cookie: cookie.split(";")[0], origin: "https://evil.example", "content-type": "application/json" },
        body: JSON.stringify({ password: "correct horse" }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("bad_origin");
  });

  it("validates the body", async () => {
    const sent = emailOn();
    const token = await codeSignIn(sent, "valid@example.com");
    const cases: [unknown, number, string][] = [
      [{ password: "short" }, 400, "too_short"],
      [{ password: "x".repeat(129) }, 400, "too_long"],
      [{}, 400, "invalid"],
      [{ password: 12345678 }, 400, "invalid"],
      [{ password: "correct horse", extra: 1 }, 400, "invalid"],
    ];
    for (const [body, status, code] of cases) {
      const res = await setPassword(token, body);
      expect([res.status, (await res.json()).code], JSON.stringify(body)).toEqual([status, code]);
    }
    expect((await setPassword(token, { password: "x".repeat(128) })).status).toBe(200);
  });

  it("a blocked account is refused", async () => {
    const sent = emailOn();
    const token = await codeSignIn(sent, "minor@example.com");
    const db = await getDb();
    await db.execute({
      sql: 'UPDATE "user" SET age_blocked_at = ? WHERE email = ?',
      args: [new Date().toISOString(), "minor@example.com"],
    });
    const res = await setPassword(token, { password: "correct horse" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("age_blocked");
  });

  it("replacing needs the current password or a recent sign-in", async () => {
    const sent = emailOn();
    const token = await codeSignIn(sent, "change@example.com");
    expect((await setPassword(token, { password: "first password" })).status).toBe(200);
    // The session is minutes old at most: no old password needed.
    expect((await setPassword(token, { password: "second password" })).status).toBe(200);

    await age(token, 30);
    const needs = await setPassword(token, { password: "third password" });
    expect(needs.status).toBe(403);
    expect((await needs.json()).code).toBe("password_required");

    const wrong = await setPassword(token, { password: "third password", current: "not the password" });
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).code).toBe("password_wrong");
    expect((await signInPassword("change@example.com", "second password")).status).toBe(200);

    expect((await setPassword(token, { password: "third password", current: "second password" })).status).toBe(200);
    expect((await signInPassword("change@example.com", "second password")).status).toBe(401);
    expect((await signInPassword("change@example.com", "third password")).status).toBe(200);
  });

  it("a first password needs a recent sign-in too", async () => {
    const sent = emailOn();
    const token = await codeSignIn(sent, "stale@example.com");
    await age(token, 30);
    const res = await setPassword(token, { password: "first password" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("password_required");
    expect((await signInPassword("stale@example.com", "first password")).status).toBe(401);
  });

  it("a wrong current password is refused even on a recent session", async () => {
    const sent = emailOn();
    const token = await codeSignIn(sent, "fresh@example.com");
    await setPassword(token, { password: "first password" });
    const res = await setPassword(token, { password: "second password", current: "not the password" });
    expect((await res.json()).code).toBe("password_wrong");
  });

  it("signs the other sessions out and keeps this one", async () => {
    const sent = emailOn();
    const first = await codeSignIn(sent, "revoke@example.com");
    await setPassword(first, { password: "first password" });
    const other = ((await (await signInPassword("revoke@example.com", "first password")).json()) as { token: string })
      .token;
    expect((await me(other)).status).toBe(200);
    expect((await setPassword(first, { password: "second password" })).status).toBe(200);
    expect((await me(first)).status).toBe(200);
    expect((await me(other)).status).toBe(401);
  });

  it("the first password signs no other session out", async () => {
    const sent = emailOn();
    const phone = await codeSignIn(sent, "first@example.com");
    const browser = await codeSignIn(sent, "first@example.com");
    expect((await setPassword(browser, { password: "first password" })).status).toBe(200);
    expect((await me(phone)).status).toBe(200);
    expect((await me(browser)).status).toBe(200);
    // Changing it does.
    expect((await setPassword(browser, { password: "second password" })).status).toBe(200);
    expect((await me(phone)).status).toBe(401);
  });

  it("refuses to set a password on the review account", async () => {
    emailOn();
    vi.stubEnv("REVIEW_ACCOUNT_EMAIL", "review3@example.com");
    vi.stubEnv("REVIEW_ACCOUNT_CODE", "482915");
    expect((await sendCode("review3@example.com")).status).toBe(200);
    const signed = await post("/sign-in/email-otp", { email: "review3@example.com", otp: "482915" });
    const token = ((await signed.json()) as { token: string }).token;
    const res = await setPassword(token, { password: "correct horse" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("invalid");
    expect((await signInPassword("review3@example.com", "correct horse")).status).toBe(401);
  });

  it("forgot password: a new code sign-in lets a new password replace the old one", async () => {
    const sent = emailOn();
    const first = await codeSignIn(sent, "forgot@example.com");
    await setPassword(first, { password: "old password" });
    await age(first, 60);

    const again = await codeSignIn(sent, "forgot@example.com");
    expect((await setPassword(again, { password: "new password" })).status).toBe(200);
    expect((await signInPassword("forgot@example.com", "old password")).status).toBe(401);
    expect((await signInPassword("forgot@example.com", "new password")).status).toBe(200);
    expect((await me(first)).status).toBe(401);
  });

  it("refuses a password for an address that was never verified", async () => {
    const sent = emailOn();
    const token = await codeSignIn(sent, "unproven@example.com");
    const db = await getDb();
    await db.execute({ sql: 'UPDATE "user" SET emailVerified = 0 WHERE email = ?', args: ["unproven@example.com"] });
    const res = await setPassword(token, { password: "correct horse" });
    expect(res.status).toBe(403);
    expect((await signInPassword("unproven@example.com", "correct horse")).status).toBe(401);
  });

  it("refuses password sign-in once the address is no longer verified", async () => {
    const sent = emailOn();
    const token = await codeSignIn(sent, "lapsed@example.com");
    await setPassword(token, { password: "correct horse" });
    const db = await getDb();
    await db.execute({ sql: 'UPDATE "user" SET emailVerified = 0 WHERE email = ?', args: ["lapsed@example.com"] });
    expect((await signInPassword("lapsed@example.com", "correct horse")).status).toBe(403);
  });

  it("two first-password requests at once leave one credential row", async () => {
    const sent = emailOn();
    const token = await codeSignIn(sent, "race@example.com");
    const both = await Promise.all([
      setPassword(token, { password: "first password" }),
      setPassword(token, { password: "second password" }),
    ]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    const db = await getDb();
    const rs = await db.execute({
      sql: 'SELECT COUNT(*) AS n FROM account WHERE providerId = ? AND userId = (SELECT id FROM "user" WHERE email = ?)',
      args: ["credential", "race@example.com"],
    });
    expect(Number(rs.rows[0].n)).toBe(1);
    // Which request reaches the writer first depends on timing; the later
    // one wins, and only its password works.
    const signIns = [
      (await signInPassword("race@example.com", "first password")).status,
      (await signInPassword("race@example.com", "second password")).status,
    ];
    expect(signIns.filter((s) => s === 200)).toHaveLength(1);
  });

  it("limits attempts per account", async () => {
    const sent = emailOn();
    const token = await codeSignIn(sent, "spam@example.com");
    await setPassword(token, { password: "first password" });
    await age(token, 30);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await setPassword(token, { password: "other password", current: "a guess" })).status);
    }
    expect(statuses).toEqual([403, 403, 403, 403, 429, 429]);
  });
});

describe("needsPassword in /me", () => {
  const needs = async (token: string) => ((await (await me(token)).json()) as { needsPassword: boolean }).needsPassword;

  it("is true after a code sign-in until a password is set", async () => {
    const sent = emailOn();
    const token = await codeSignIn(sent, "needs@example.com");
    expect(await needs(token)).toBe(true);
    await setPassword(token, { password: "first password" });
    expect(await needs(token)).toBe(false);
  });

  it("is false for the review account, which signs in with its fixed code", async () => {
    emailOn();
    vi.stubEnv("REVIEW_ACCOUNT_EMAIL", "review2@example.com");
    vi.stubEnv("REVIEW_ACCOUNT_CODE", "482915");
    expect((await sendCode("review2@example.com")).status).toBe(200);
    const res = await post("/sign-in/email-otp", { email: "review2@example.com", otp: "482915" });
    expect(res.status).toBe(200);
    expect(await needs(((await res.json()) as { token: string }).token)).toBe(false);
  });

  it("is false when the deployment has no passwords", async () => {
    const sent = emailOn();
    const token = await codeSignIn(sent, "off@example.com");
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await needs(token)).toBe(false);
  });
});

describe("the emailed code", () => {
  it("answers 503 unavailable when the email service refuses it, for known and unknown addresses", async () => {
    const sent = emailOn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await codeSignIn(sent, "down@example.com");
    resendStatus = 500;
    for (const email of ["down@example.com", "never-seen@example.com"]) {
      const res = await sendCode(email);
      expect(res.status, email).toBe(503);
      expect((await res.json()).code).toBe("unavailable");
    }
    expect(sent).toHaveLength(1);
  });

  it("answers 503 when the email service cannot be reached", async () => {
    emailOn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await sendCode("offline@example.com")).status).toBe(503);
  });

  it("a failed resend leaves the code already delivered usable", async () => {
    const sent = emailOn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await sendCode("resend@example.com")).status).toBe(200);
    const first = codeFrom(sent[0]);
    resendStatus = 500;
    expect((await sendCode("resend@example.com")).status).toBe(503);
    expect((await post("/sign-in/email-otp", { email: "resend@example.com", otp: first })).status).toBe(200);
  });

  it("the review account still gets its fixed code and no email", async () => {
    const sent = emailOn();
    vi.stubEnv("REVIEW_ACCOUNT_EMAIL", "review@example.com");
    vi.stubEnv("REVIEW_ACCOUNT_CODE", "482915");
    resendStatus = 500;
    const res = await sendCode("review@example.com");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(sent).toHaveLength(0);
    expect((await post("/sign-in/email-otp", { email: "review@example.com", otp: "482915" })).status).toBe(200);
  });

  it("a good send is unchanged", async () => {
    const sent = emailOn();
    const res = await sendCode("fine@example.com");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(sent).toHaveLength(1);
  });
});
