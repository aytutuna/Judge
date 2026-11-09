import { describe, expect, it } from "vitest";

// The client has no baseURL (the browser's own origin); outside a browser
// Better Auth reads one from the environment. It also keeps the fetch that
// exists when it is imported, so the stand-in goes in first.
process.env.BETTER_AUTH_URL = "http://localhost:3600";
type Reply = { status: number; body: unknown } | "offline";
const seen = { urls: [] as string[], bodies: [] as unknown[] };
let reply: Reply = { status: 200, body: {} };
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : null;
  seen.urls.push(req ? req.url : String(input));
  seen.bodies.push(JSON.parse(String(req ? await req.text() : init?.body)));
  if (reply === "offline") throw new TypeError("Failed to fetch");
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;
const { codeErrorKey, sendSignInCode, signInWithCode } = await import("../lib/auth-client");

function answer(status: number, body: unknown): typeof seen {
  seen.urls.length = 0;
  seen.bodies.length = 0;
  reply = { status, body };
  return seen;
}

describe("codeErrorKey", () => {
  it("maps the server's code errors the way the apps do", () => {
    expect(codeErrorKey("INVALID_OTP", "verify")).toBe("signin.codeInvalid");
    expect(codeErrorKey("OTP_EXPIRED", "verify")).toBe("signin.codeExpired");
    expect(codeErrorKey("TOO_MANY_ATTEMPTS", "verify")).toBe("signin.codeTooMany");
    expect(codeErrorKey("http_400", "verify")).toBe("signin.codeInvalid");
  });

  it("rate limits, outages and a lost connection read the same on both steps", () => {
    for (const step of ["send", "verify"] as const) {
      expect(codeErrorKey("http_429", step)).toBe("signin.rateLimited");
      expect(codeErrorKey("http_404", step)).toBe("signin.serviceDown");
      expect(codeErrorKey("http_503", step)).toBe("signin.serviceDown");
      expect(codeErrorKey("network", step)).toBe("signin.offline");
    }
  });

  it("sending: a refused address is an email problem, anything else a plain failure", () => {
    expect(codeErrorKey("http_400", "send")).toBe("signin.emailInvalid");
    expect(codeErrorKey("INVALID_OTP", "send")).toBe("signin.failed");
    expect(codeErrorKey("failed", "send")).toBe("signin.failed");
    expect(codeErrorKey("something_else", "verify")).toBe("signin.failed");
  });
});

describe("code helpers", () => {
  it("sendSignInCode posts a sign-in code request with the language", async () => {
    const seen = answer(200, { success: true });
    expect(await sendSignInCode("a@b.co", "tr")).toEqual({ ok: true });
    expect(seen.urls[0]).toContain("/api/auth/email-otp/send-verification-otp");
    expect(seen.urls[0]).toContain("lang=tr");
    expect(seen.bodies[0]).toEqual({ email: "a@b.co", type: "sign-in" });
  });

  it("signInWithCode posts the email and the digits", async () => {
    const seen = answer(200, { token: "t", user: { id: "u" } });
    expect(await signInWithCode("a@b.co", "480213")).toEqual({ ok: true });
    expect(seen.urls[0]).toContain("/api/auth/sign-in/email-otp");
    expect(seen.bodies[0]).toEqual({ email: "a@b.co", otp: "480213" });
  });

  it("failures carry the server's code, or http_<status>", async () => {
    answer(400, { code: "INVALID_OTP", message: "Invalid OTP" });
    expect(await signInWithCode("a@b.co", "000000")).toEqual({ ok: false, code: "INVALID_OTP" });
    answer(403, { code: "TOO_MANY_ATTEMPTS", message: "Too many attempts" });
    expect(await signInWithCode("a@b.co", "000000")).toEqual({ ok: false, code: "TOO_MANY_ATTEMPTS" });
    answer(429, { message: "Too many requests. Please try again later." });
    expect(await sendSignInCode("a@b.co", "en")).toEqual({ ok: false, code: "http_429" });
  });

  it("a request that never gets an answer is a network failure", async () => {
    reply = "offline";
    expect(await sendSignInCode("a@b.co", "en")).toEqual({ ok: false, code: "network" });
    expect(await signInWithCode("a@b.co", "000000")).toEqual({ ok: false, code: "network" });
  });
});
