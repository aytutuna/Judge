import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-lookup-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3602";

const auth = await import("../lib/auth");
const { POST } = await import("../app/api/v1/auth/lookup/route");

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
});

const lookup = (body: unknown, ip = "203.0.113.7") =>
  POST(
    new Request("http://localhost:3602/api/v1/auth/lookup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

async function method(email: string, ip?: string) {
  const res = await lookup({ email }, ip);
  expect(res.status).toBe(200);
  return ((await res.json()) as { method: string }).method;
}

describe("POST /api/v1/auth/lookup", () => {
  it("says new, code or password, ignoring case and spaces", async () => {
    expect(await method("fresh@example.com")).toBe("new");

    const made = await auth.findOrCreateUserByEmail("social@example.com", true);
    expect(made?.created).toBe(true);
    expect(await method("Social@Example.com")).toBe("code");
    expect(await method("  social@example.com ")).toBe("code");

    const withPassword = await auth.findOrCreateUserByEmail("pw@example.com", true);
    const ctx = await (await auth.getAuth()).$context;
    await ctx.internalAdapter.linkAccount({
      userId: withPassword!.user.id,
      providerId: "credential",
      accountId: withPassword!.user.id,
      password: await ctx.password.hash("correct horse"),
    });
    expect(await method("PW@example.com")).toBe("password");
  });

  it("refuses a body that is not an email", async () => {
    for (const body of [{}, { email: "nope" }, { email: 5 }, { email: "a@b.co", extra: 1 }, "not json"]) {
      const res = await lookup(body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("invalid");
    }
  });

  it("allows ten tries for one address and IP, then answers 429", async () => {
    for (let i = 0; i < 10; i++) expect((await lookup({ email: "busy@example.com" }, "198.51.100.1")).status).toBe(200);
    const res = await lookup({ email: "busy+alias@example.com" }, "198.51.100.1");
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe("rate_limited");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await lookup({ email: "busy@example.com" }, "198.51.100.2")).status).toBe(200);
  });

  it("caps one IP across many addresses at thirty", async () => {
    let last = 200;
    let ok = 0;
    for (let i = 0; i < 35 && last === 200; i++) {
      last = (await lookup({ email: `walk${i}@example.com` }, "192.0.2.50")).status;
      if (last === 200) ok++;
    }
    expect(ok).toBe(30);
    expect(last).toBe(429);
  });
});
