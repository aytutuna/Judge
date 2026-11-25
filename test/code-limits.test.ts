import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-code-limits-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3601";

const auth = await import("../lib/auth");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Sent = { to: string[]; text: string };

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
        sent.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: "x" }), { status: 200 });
      }
      return realFetch(input, init);
    }),
  );
  return sent;
}

async function post(p: string, body: unknown, ip = "203.0.113.1", headers: Record<string, string> = {}): Promise<Response> {
  const instance = await auth.getAuth();
  return instance.handler(
    new Request(`http://localhost:3601/api/auth${p}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const sendCode = (email: string, ip?: string, headers?: Record<string, string>) =>
  post("/email-otp/send-verification-otp", { email, type: "sign-in" }, ip, headers);
const signIn = (email: string, otp: string, ip?: string) => post("/sign-in/email-otp", { email, otp }, ip);

describe("sign-in code limits per address", () => {
  it("stops sending after five codes an hour, aliases included", async () => {
    const sent = emailOn();
    for (let i = 0; i < 5; i++) expect((await sendCode(`send+${i}@example.com`)).status).toBe(200);
    expect(sent).toHaveLength(5);
    const res = await sendCode("send@example.com");
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe("RATE_LIMITED");
    expect((await sendCode("Send+more@example.com")).status).toBe(429);
    expect(sent).toHaveLength(5);
    expect((await sendCode("other@example.com")).status).toBe(200);
  });

  it("caps guesses at ten an hour even when every resend resets the code", async () => {
    emailOn();
    let tries = 0;
    let last: Response | null = null;
    for (let round = 0; round < 6 && tries < 10; round++) {
      await sendCode("guess@example.com");
      for (let i = 0; i < 3 && tries < 10; i++, tries++) last = await signIn("guess@example.com", "000000");
      expect(last!.status).not.toBe(429);
    }
    expect(tries).toBe(10);
    const res = await signIn("guess@example.com", "000000");
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe("RATE_LIMITED");
  });

  it("does not let one IP block the same address from another", async () => {
    emailOn();
    for (let i = 0; i < 5; i++) expect((await sendCode("victim@example.com", "198.51.100.1")).status).toBe(200);
    expect((await sendCode("victim@example.com", "198.51.100.1")).status).toBe(429);
    expect((await sendCode("victim@example.com", "198.51.100.2")).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await signIn("victim@example.com", "000000", "198.51.100.1")).status).not.toBe(429);
    expect((await signIn("victim@example.com", "000000", "198.51.100.1")).status).toBe(429);
    expect((await signIn("victim@example.com", "000000", "198.51.100.2")).status).not.toBe(429);
  });

  it("keeps a looser ceiling on the address across IPs", async () => {
    emailOn();
    // 5 per IP and 10 a day per address, from any IPs.
    let sent = 0;
    let last = 200;
    for (let ip = 1; ip <= 6 && last === 200; ip++) {
      for (let i = 0; i < 5 && last === 200; i++) {
        last = (await sendCode("many@example.com", `192.0.2.${ip}`)).status;
        if (last === 200) sent++;
      }
    }
    expect(sent).toBe(10);
    expect(last).toBe(429);
    expect((await sendCode("many@example.com", "192.0.2.99")).status).toBe(429);
  });

  it("holds an address to ten codes a day, spread over any IPs, then frees it", async () => {
    const sent = emailOn();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 3 * 86_400_000);
    for (let i = 0; i < 10; i++) {
      expect((await sendCode("Daily+x@example.com", `198.18.0.${i + 1}`)).status).toBe(200);
      vi.setSystemTime(Date.now() + 10 * 60_000);
    }
    expect((await sendCode("daily@example.com", "198.18.0.99")).status).toBe(429);
    expect(sent).toHaveLength(10);
    vi.setSystemTime(Date.now() + 86_400_000);
    expect((await sendCode("daily@example.com", "198.18.0.99")).status).toBe(200);
  });
});

describe("the daily send cap and codes already sent", () => {
  it("never blocks signing in with the last unexpired code, and frees sending after 24 hours", async () => {
    const sent = emailOn();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 40 * 86_400_000);
    for (let i = 0; i < 10; i++) {
      expect((await sendCode("cap-user@example.com", `198.18.20.${i}`)).status).toBe(200);
      vi.setSystemTime(Date.now() + 1_000);
    }
    const refused = await sendCode("cap-user@example.com", "198.18.20.99");
    expect(refused.status).toBe(429);
    expect(sent).toHaveLength(10);
    // The refused request must not have replaced the last code.
    const code = /\b(\d{6})\b/.exec(sent[9].text)![1];
    expect((await signIn("cap-user@example.com", code, "198.18.20.50")).status).toBe(200);

    vi.setSystemTime(Date.now() + 86_400_000 + 1_000);
    expect((await sendCode("cap-user@example.com", "198.18.20.51")).status).toBe(200);
  });
});

describe("site-wide code email cap", () => {
  it("refuses sends past the hourly cap and raises the signal", async () => {
    const sent = emailOn();
    vi.stubEnv("CODE_EMAILS_PER_HOUR", "3");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 3; i++) expect((await sendCode(`cap${i}@example.com`, `198.19.0.${i}`)).status).toBe(200);
    const res = await sendCode("cap9@example.com", "198.19.0.9");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("unavailable");
    expect(sent).toHaveLength(3);
    expect(warn.mock.calls.flat()).toContain("[signal:code_email_cap]");
    warn.mockRestore();
  });

  it("does not count requests the address limits already refused", async () => {
    const sent = emailOn();
    vi.stubEnv("CODE_EMAILS_PER_HOUR", "6");
    for (let i = 0; i < 5; i++) expect((await sendCode("same@example.org", "198.19.1.1")).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await sendCode("same@example.org", "198.19.1.1")).status).toBe(429);
    expect((await sendCode("next@example.org", "198.19.1.2")).status).toBe(200);
    expect(sent).toHaveLength(6);
  });
});

describe("Turnstile on code requests", () => {
  const APP = { "device-id": "device-abcdef123456", "device-platform": "ios" };

  function turnstileOn(): { siteverify: number } {
    const seen = { siteverify: 0 };
    const base = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/turnstile/v0/siteverify")) {
          seen.siteverify++;
          const token = new URLSearchParams(String(init?.body)).get("response");
          return new Response(JSON.stringify({ success: token === "good" }), { status: 200 });
        }
        return base(input, init);
      }),
    );
    vi.stubEnv("TURNSTILE_SECRET_KEY", "0x4AAAAAAAtest");
    return seen;
  }

  it("is required from the website: no token or a bad one is refused without sending", async () => {
    const sent = emailOn();
    const seen = turnstileOn();
    const none = await sendCode("web1@example.com", "198.51.100.30", { origin: "http://localhost:3601" });
    expect(none.status).toBe(403);
    expect(((await none.json()) as { code: string }).code).toBe("CAPTCHA_FAILED");
    const bad = await sendCode("web1@example.com", "198.51.100.30", { "x-captcha-response": "nope" });
    expect(bad.status).toBe(403);
    expect(sent).toHaveLength(0);
    expect(seen.siteverify).toBe(1);
  });

  it("lets a website request with a good token through", async () => {
    const sent = emailOn();
    turnstileOn();
    const res = await sendCode("web2@example.com", "198.51.100.31", { "x-captcha-response": "good" });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("is not asked of the apps, which send their device headers and no Origin", async () => {
    const sent = emailOn();
    const seen = turnstileOn();
    expect((await sendCode("app1@example.com", "198.51.100.32", APP)).status).toBe(200);
    expect((await sendCode("app2@example.com", "198.51.100.32", { ...APP, "device-platform": "android" })).status).toBe(200);
    expect(sent).toHaveLength(2);
    expect(seen.siteverify).toBe(0);
  });

  it("does not take the app headers from a browser, malformed ids or other platforms", async () => {
    emailOn();
    turnstileOn();
    const bad: Record<string, string>[] = [
      { ...APP, origin: "http://localhost:3601" },
      { ...APP, "device-platform": "web" },
      { ...APP, "device-id": "short" },
      { "device-platform": "ios" },
    ];
    for (const [i, h] of bad.entries()) {
      expect((await sendCode(`probe${i}@example.com`, "198.51.100.33", h)).status, String(i)).toBe(403);
    }
  });

  it("an outage of the check refuses the send as unavailable", async () => {
    const sent = emailOn();
    turnstileOn();
    expect((await sendCode("web3@example.com", "198.51.100.34", { "x-captcha-response": "good" })).status).toBe(200);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = await sendCode("web4@example.com", "198.51.100.35", { "x-captcha-response": "good" });
    expect(down.status).toBe(503);
    expect(sent).toHaveLength(1);
  });

  it("never applies to the review address, which sends nothing", async () => {
    const sent = emailOn();
    turnstileOn();
    vi.stubEnv("REVIEW_ACCOUNT_EMAIL", "tsreview@okjudge.test");
    vi.stubEnv("REVIEW_ACCOUNT_CODE", "480213");
    vi.stubEnv("CODE_EMAILS_PER_HOUR", "0");
    const res = await sendCode("tsreview@okjudge.test", "198.51.100.36", { origin: "http://localhost:3601" });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
    expect((await signIn("tsreview@okjudge.test", "480213", "198.51.100.36")).status).toBe(200);
  });
});

describe("per-IP sends, malformed addresses, review guesses", () => {
  it("holds one IP to ten code requests an hour across addresses", async () => {
    const sent = emailOn();
    for (let i = 0; i < 10; i++) expect((await sendCode(`ip${i}@example.net`, "198.18.9.1")).status).toBe(200);
    const res = await sendCode("ip10@example.net", "198.18.9.1");
    expect(res.status).toBe(429);
    expect(sent).toHaveLength(10);
    expect((await sendCode("ip11@example.net", "198.18.9.2")).status).toBe(200);
  });

  it("keeps one IP from using up the site-wide cap", async () => {
    emailOn();
    vi.stubEnv("CODE_EMAILS_PER_HOUR", "50");
    for (let i = 0; i < 15; i++) await sendCode(`flood${i}@example.net`, "198.18.9.3");
    expect((await sendCode("fine@example.net", "198.18.9.4")).status).toBe(200);
  });

  it("refuses a malformed address before any limit or Turnstile check", async () => {
    emailOn();
    vi.stubEnv("CODE_EMAILS_PER_HOUR", "2");
    const siteverify = vi.fn(async () => new Response(JSON.stringify({ success: true })));
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", (i: RequestInfo | URL, init?: RequestInit) =>
      String(i).includes("siteverify") ? siteverify() : base(i, init),
    );
    vi.stubEnv("TURNSTILE_SECRET_KEY", "0x4AAAAAAAtest");
    for (const bad of ["x", " a@b.com ", "a@b", "a b@c.de"]) {
      const res = await sendCode(bad, "198.18.9.5", { "x-captcha-response": "good" });
      expect(res.status, bad).toBe(400);
    }
    expect(siteverify).not.toHaveBeenCalled();
    expect((await sendCode("ok1@example.net", "198.18.9.6", { "x-captcha-response": "good" })).status).toBe(200);
    expect((await sendCode("ok2@example.net", "198.18.9.7", { "x-captcha-response": "good" })).status).toBe(200);
    expect((await sendCode("ok3@example.net", "198.18.9.8", { "x-captcha-response": "good" })).status).toBe(503);
  });

  it("signals the site-wide cap once an hour, not on every refusal", async () => {
    emailOn();
    vi.stubEnv("CODE_EMAILS_PER_HOUR", "0");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10 * 86_400_000);
    for (let i = 0; i < 4; i++) expect((await sendCode(`once${i}@example.net`, `198.18.10.${i}`)).status).toBe(503);
    const lines = () => warn.mock.calls.flat().filter((l) => l === "[signal:code_email_cap]").length;
    expect(lines()).toBe(1);
    vi.setSystemTime(Date.now() + 3_600_000 + 1_000);
    await sendCode("once9@example.net", "198.18.10.9");
    expect(lines()).toBe(2);
  });

  it("caps guesses at the review code site-wide, signals it, and still lets sends through", async () => {
    emailOn();
    vi.stubEnv("REVIEW_ACCOUNT_EMAIL", "spread@okjudge.test");
    vi.stubEnv("REVIEW_ACCOUNT_CODE", "480213");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 20 * 86_400_000);
    // Ten guesses from each of thirty IPs: the per-IP limit never trips.
    let refused = 0;
    for (let ip = 1; ip <= 31; ip++) {
      for (let i = 0; i < 10; i++) {
        const res = await signIn("spread@okjudge.test", "000000", `198.18.11.${ip}`);
        if (res.status === 429) refused++;
      }
    }
    expect(refused).toBeGreaterThan(0);
    expect(warn.mock.calls.flat().filter((l) => l === "[signal:review_guess_cap]")).toHaveLength(1);
    expect((await sendCode("spread@okjudge.test", "198.18.12.1")).status).toBe(200);
  });
});

describe("default code email cap", () => {
  it("is 100 an hour unless CODE_EMAILS_PER_HOUR says otherwise, and 0 stops code emails", async () => {
    const { checkCodeEmailCap } = await import("../lib/ratelimit");
    // Last in the file, in a month nobody else sent in, so the shared hour is empty.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 100 * 86_400_000);
    vi.stubEnv("CODE_EMAILS_PER_HOUR", "0");
    expect((await checkCodeEmailCap(process.env)).ok).toBe(false);
    vi.stubEnv("CODE_EMAILS_PER_HOUR", "junk");
    for (let i = 0; i < 100; i++) expect((await checkCodeEmailCap(process.env)).ok, String(i)).toBe(true);
    expect((await checkCodeEmailCap(process.env)).ok).toBe(false);
  });
});
