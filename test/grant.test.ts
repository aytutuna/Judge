import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-grant-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");

const { parseGrantArgs, runGrant } = await import("../scripts/grant");
const { createDevSession } = await import("../lib/auth");
const { getEntitlement } = await import("../lib/entitlements");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

describe("parseGrantArgs", () => {
  it("parses each action", () => {
    expect(parseGrantArgs(["A@Example.com", "--credits", "20"])).toEqual({
      email: "a@example.com",
      action: { kind: "credits", credits: 20 },
      create: false,
    });
    expect(parseGrantArgs(["a@example.com", "--subscription", "30d", "--create"])).toEqual({
      email: "a@example.com",
      action: { kind: "subscription", days: 30 },
      create: true,
    });
    expect(parseGrantArgs(["a@example.com", "--revoke"])).toMatchObject({ action: { kind: "revoke" } });
    expect(parseGrantArgs(["--show", "a@example.com"])).toMatchObject({ action: { kind: "show" } });
  });

  it("rejects bad input with a message", () => {
    for (const argv of [
      [],
      ["not-an-email", "--credits", "5"],
      ["a@example.com"],
      ["a@example.com", "--credits"],
      ["a@example.com", "--credits", "0"],
      ["a@example.com", "--credits", "2.5"],
      ["a@example.com", "--subscription", "30"],
      ["a@example.com", "--subscription", "0d"],
      ["a@example.com", "--credits", "5", "--revoke"],
      ["a@example.com", "--bogus"],
      ["a@example.com", "b@example.com", "--show"],
    ]) {
      expect(parseGrantArgs(argv), argv.join(" ")).toHaveProperty("error");
    }
  });
});

describe("runGrant", () => {
  it("refuses an unknown email unless --create", async () => {
    const res = await runGrant({ email: "nobody@example.com", action: { kind: "credits", credits: 5 }, create: false });
    expect(res.code).toBe(1);
    expect(res.lines.join("\n")).toMatch(/Sign in once first, or pass --create/);
  });

  it("--create makes the account and grants", async () => {
    const res = await runGrant({ email: "new@example.com", action: { kind: "credits", credits: 5 }, create: true });
    expect(res.code).toBe(0);
    expect(res.lines[0]).toMatch(/^Created account new@example\.com/);
    expect(res.lines.join("\n")).toContain('"credits": 5');
  });

  it("credits, subscription, show and revoke on an existing account", async () => {
    const { user } = await createDevSession("granted@verdict.local");
    const email = "granted@verdict.local";
    const now = new Date();

    await runGrant({ email, action: { kind: "credits", credits: 20 }, create: false }, now);
    expect((await getEntitlement(user.id)).credits).toBe(20);

    const sub = await runGrant({ email, action: { kind: "subscription", days: 30 }, create: false }, now);
    expect(sub.code).toBe(0);
    const e = await getEntitlement(user.id);
    expect(e.subscription).toMatchObject({ source: "admin", productId: "monthly", cap: 200, willRenew: false });
    expect(Date.parse(e.subscription!.periodEnd) - now.getTime()).toBe(30 * 24 * 60 * 60 * 1000);

    const show = await runGrant({ email, action: { kind: "show" }, create: false });
    expect(JSON.parse(show.lines.slice(-1)[0])).toMatchObject({ credits: 20, canUsePremium: true });

    await runGrant({ email, action: { kind: "revoke" }, create: false });
    expect(await getEntitlement(user.id)).toMatchObject({
      credits: 0,
      subscription: null,
      canUsePremium: false,
      blockedReason: "no_credits",
    });

    // A fresh grant after a revoke works again.
    await runGrant({ email, action: { kind: "subscription", days: 7 }, create: false });
    expect((await getEntitlement(user.id)).canUsePremium).toBe(true);
  });
});
