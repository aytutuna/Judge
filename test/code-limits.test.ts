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

async function post(p: string, body: unknown): Promise<Response> {
  const instance = await auth.getAuth();
  return instance.handler(
    new Request(`http://localhost:3601/api/auth${p}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const sendCode = (email: string) => post("/email-otp/send-verification-otp", { email, type: "sign-in" });
const signIn = (email: string, otp: string) => post("/sign-in/email-otp", { email, otp });

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
});
