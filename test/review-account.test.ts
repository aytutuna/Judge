import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-review-account-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3601";

const auth = await import("../lib/auth");
const { GET: getMe } = await import("../app/api/v1/me/route");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const ORIGIN = "http://localhost:3601";
const REVIEW_EMAIL = "review@okjudge.test";
const REVIEW_CODE = "480213";
type Sent = { to: string[]; text: string };

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

function reviewOn(email = REVIEW_EMAIL, code = REVIEW_CODE): void {
  vi.stubEnv("REVIEW_ACCOUNT_EMAIL", email);
  vi.stubEnv("REVIEW_ACCOUNT_CODE", code);
}

async function post(pathAndQuery: string, body: unknown): Promise<Response> {
  const instance = await auth.getAuth();
  return instance.handler(
    new Request(`${ORIGIN}/api/auth${pathAndQuery}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const sendCode = (email: string) => post("/email-otp/send-verification-otp", { email, type: "sign-in" });
const signIn = (email: string, otp: string) => post("/sign-in/email-otp", { email, otp });

function codeFrom(mail: Sent): string {
  const m = /\b(\d{6})\b/.exec(mail.text);
  if (!m) throw new Error("no code in the email");
  return m[1];
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reviewAccount", () => {
  it("needs both values, a valid address and a 6-digit code", () => {
    expect(auth.reviewAccount({})).toBeNull();
    expect(auth.reviewAccount({ REVIEW_ACCOUNT_EMAIL: REVIEW_EMAIL })).toBeNull();
    expect(auth.reviewAccount({ REVIEW_ACCOUNT_CODE: REVIEW_CODE })).toBeNull();
    expect(auth.reviewAccount({ REVIEW_ACCOUNT_EMAIL: "not-an-email", REVIEW_ACCOUNT_CODE: REVIEW_CODE })).toBeNull();
    for (const code of ["12345", "1234567", "48021a", "4802 13", ""]) {
      expect(auth.reviewAccount({ REVIEW_ACCOUNT_EMAIL: REVIEW_EMAIL, REVIEW_ACCOUNT_CODE: code }), code).toBeNull();
    }
  });

  it("refuses trivial codes", () => {
    for (const code of ["000000", "111111", "999999", "123456", "654321"]) {
      expect(auth.reviewAccount({ REVIEW_ACCOUNT_EMAIL: REVIEW_EMAIL, REVIEW_ACCOUNT_CODE: code }), code).toBeNull();
    }
  });

  it("normalizes the address", () => {
    expect(auth.reviewAccount({ REVIEW_ACCOUNT_EMAIL: "  Review@OkJudge.test ", REVIEW_ACCOUNT_CODE: " 480213 " })).toEqual({
      email: REVIEW_EMAIL,
      code: REVIEW_CODE,
    });
  });
});

describe("store-review sign-in", () => {
  beforeEach(() => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  });

  it("the review address signs in with the configured code and gets no email", async () => {
    const sent = emailOn();
    reviewOn();
    const spies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m));
    const res = await sendCode("Review@OkJudge.test");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(sent).toHaveLength(0);
    for (const spy of spies) expect(spy.mock.calls.flat().join(" ")).not.toContain(REVIEW_CODE);

    const signed = await signIn(REVIEW_EMAIL, REVIEW_CODE);
    expect(signed.status).toBe(200);
    const body = (await signed.json()) as { token: string; user: { email: string } };
    expect(body.user.email).toBe(REVIEW_EMAIL);
    const me = await getMe(new Request(`${ORIGIN}/api/v1/me`, { headers: { authorization: `Bearer ${body.token}` } }));
    expect(me.status).toBe(200);

    // A code is still single use: the reviewer asks for a new one each time.
    expect((await signIn(REVIEW_EMAIL, REVIEW_CODE)).status).toBe(400);
    expect((await sendCode(REVIEW_EMAIL)).status).toBe(200);
    expect((await signIn(REVIEW_EMAIL, REVIEW_CODE)).status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("the configured code works only for the review address", async () => {
    const sent = emailOn();
    reviewOn();
    expect((await sendCode("someone@example.com")).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["someone@example.com"]);
    expect(codeFrom(sent[0])).not.toBe(REVIEW_CODE);
    expect((await signIn("someone@example.com", REVIEW_CODE)).status).toBe(400);
    expect((await signIn("someone@example.com", codeFrom(sent[0]))).status).toBe(200);
  });

  it("a wrong code for the review address fails like any other", async () => {
    emailOn();
    reviewOn();
    await sendCode(REVIEW_EMAIL);
    const bad = await signIn(REVIEW_EMAIL, "000000");
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe("INVALID_OTP");
  });

  it("three wrong guesses burn the review code until a new one is requested", async () => {
    emailOn();
    reviewOn("lock-review@okjudge.test");
    await sendCode("lock-review@okjudge.test");
    for (let i = 0; i < 3; i++) expect((await signIn("lock-review@okjudge.test", "000000")).status).toBe(400);
    const locked = await signIn("lock-review@okjudge.test", REVIEW_CODE);
    expect(locked.status).toBe(403);
    expect(((await locked.json()) as { code: string }).code).toBe("TOO_MANY_ATTEMPTS");
    expect((await signIn("lock-review@okjudge.test", REVIEW_CODE)).status).toBe(400);
    await sendCode("lock-review@okjudge.test");
    expect((await signIn("lock-review@okjudge.test", REVIEW_CODE)).status).toBe(200);
  });

  it("the review code expires like any other", async () => {
    emailOn();
    reviewOn("late-review@okjudge.test");
    await sendCode("late-review@okjudge.test");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10 * 60_000 + 5_000);
    const res = await signIn("late-review@okjudge.test", REVIEW_CODE);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("OTP_EXPIRED");
  });

  it("at most ten code requests an hour get the fixed code", async () => {
    emailOn();
    reviewOn("cap-review@okjudge.test");
    // Start a fresh hour: earlier tests also counted against the cap.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * 3_600_000);
    for (let i = 0; i < 10; i++) {
      await sendCode("cap-review@okjudge.test");
      expect((await signIn("cap-review@okjudge.test", REVIEW_CODE)).status, `request ${i + 1}`).toBe(200);
    }
    await sendCode("cap-review@okjudge.test");
    expect((await signIn("cap-review@okjudge.test", REVIEW_CODE)).status).toBe(400);
    vi.setSystemTime(Date.now() + 3_600_000 + 1_000);
    await sendCode("cap-review@okjudge.test");
    expect((await signIn("cap-review@okjudge.test", REVIEW_CODE)).status).toBe(200);
  });

  it("a review address needs a code to be sent first", async () => {
    emailOn();
    reviewOn("fresh-review@okjudge.test");
    expect((await signIn("fresh-review@okjudge.test", REVIEW_CODE)).status).toBe(400);
  });

  it("an unusable code setting falls back to a normal emailed code", async () => {
    const sent = emailOn();
    reviewOn(REVIEW_EMAIL, "123456");
    expect((await sendCode(REVIEW_EMAIL)).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([REVIEW_EMAIL]);
    expect((await signIn(REVIEW_EMAIL, "123456")).status).toBe(400);
    expect((await signIn(REVIEW_EMAIL, codeFrom(sent[0]))).status).toBe(200);
  });

  it("without email sign-in configured there is no code endpoint at all", async () => {
    reviewOn();
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    expect((await sendCode(REVIEW_EMAIL)).status).toBe(404);
  });
});
