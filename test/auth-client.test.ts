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

async function failed(call: Promise<{ ok: boolean }>) {
  const res = await call;
  if (res.ok) throw new Error("expected a failure");
  return res as { ok: false; code: string; status?: number };
}

function answer(status: number, body: unknown): typeof seen {
  seen.urls.length = 0;
  seen.bodies.length = 0;
  reply = { status, body };
  return seen;
}

describe("codeErrorKey", () => {
  it("maps the server's code errors the way the apps do", () => {
    expect(codeErrorKey({ code: "INVALID_OTP", status: 400 }, "verify")).toBe("signin.codeInvalid");
    expect(codeErrorKey({ code: "OTP_EXPIRED", status: 403 }, "verify")).toBe("signin.codeExpired");
    expect(codeErrorKey({ code: "TOO_MANY_ATTEMPTS", status: 403 }, "verify")).toBe("signin.codeTooMany");
    expect(codeErrorKey({ code: "http_400", status: 400 }, "verify")).toBe("signin.codeInvalid");
  });

  it("rate limits, outages and a lost connection read the same on both steps", () => {
    for (const step of ["send", "verify"] as const) {
      expect(codeErrorKey({ code: "http_429", status: 429 }, step)).toBe("signin.rateLimited");
      expect(codeErrorKey({ code: "http_404", status: 404 }, step)).toBe("signin.serviceDown");
      expect(codeErrorKey({ code: "http_503", status: 503 }, step)).toBe("signin.serviceDown");
      expect(codeErrorKey({ code: "network" }, step)).toBe("signin.offline");
    }
  });

  it("sending: a refused address is an email problem, anything else a plain failure", () => {
    expect(codeErrorKey({ code: "http_400", status: 400 }, "send")).toBe("signin.emailInvalid");
    expect(codeErrorKey({ code: "INVALID_OTP", status: 400 }, "send")).toBe("signin.emailInvalid");
    expect(codeErrorKey({ code: "failed" }, "send")).toBe("signin.failed");
    expect(codeErrorKey({ code: "something_else" }, "verify")).toBe("signin.failed");
  });

  it("the replies the server really sends, whose body also carries a code", async () => {
    answer(400, { code: "INVALID_EMAIL", message: "Invalid email" });
    expect(codeErrorKey(await failed(sendSignInCode("a@b.c", "en")), "send")).toBe("signin.emailInvalid");
    answer(503, { code: "unavailable" });
    expect(codeErrorKey(await failed(sendSignInCode("a@b.co", "en")), "send")).toBe("signin.serviceDown");
    answer(503, { code: "unavailable" });
    expect(codeErrorKey(await failed(signInWithCode("a@b.co", "000000")), "verify")).toBe("signin.serviceDown");
    answer(404, { code: "not_found" });
    expect(codeErrorKey(await failed(sendSignInCode("a@b.co", "en")), "send")).toBe("signin.serviceDown");
    answer(400, { code: "INVALID_OTP", message: "Invalid OTP" });
    expect(codeErrorKey(await failed(signInWithCode("a@b.co", "000000")), "verify")).toBe("signin.codeInvalid");
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
    expect(await signInWithCode("a@b.co", "000000")).toEqual({ ok: false, code: "INVALID_OTP", status: 400 });
    answer(403, { code: "TOO_MANY_ATTEMPTS", message: "Too many attempts" });
    expect(await signInWithCode("a@b.co", "000000")).toEqual({ ok: false, code: "TOO_MANY_ATTEMPTS", status: 403 });
    answer(429, { message: "Too many requests. Please try again later." });
    expect(await sendSignInCode("a@b.co", "en")).toEqual({ ok: false, code: "http_429", status: 429 });
  });

  it("a request that never gets an answer is a network failure", async () => {
    reply = "offline";
    expect(await sendSignInCode("a@b.co", "en")).toEqual({ ok: false, code: "network" });
    expect(await signInWithCode("a@b.co", "000000")).toEqual({ ok: false, code: "network" });
  });
});
