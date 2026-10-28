import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-welcome-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");

const { createDevSession, findOrCreateUserByEmail } = await import("../lib/auth");
const ent = await import("../lib/entitlements");
const { getDb } = await import("../lib/db");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

async function welcomeGrants(userId: string): Promise<number> {
  const db = await getDb();
  const rs = await db.execute({
    sql: "SELECT count(*) AS n FROM entitlement_grants WHERE user_id = ? AND source = 'promo' AND external_id = ?",
    args: [userId, `welcome:${userId}`],
  });
  return Number(rs.rows[0].n);
}

describe("welcome credit", () => {
  it("a new account starts with one credit", async () => {
    const { user } = await createDevSession("welcome1@verdict.local");
    expect(await ent.getEntitlement(user.id)).toMatchObject({ canUsePremium: true, credits: 1, blockedReason: null });
    expect(await welcomeGrants(user.id)).toBe(1);
  });

  it("is granted once: signing in again and a repeated grant add nothing", async () => {
    const { user } = await createDevSession("welcome2@verdict.local");
    await createDevSession("welcome2@verdict.local");
    expect(await ent.grantWelcomeCredit(user.id)).toEqual({ applied: false });
    expect((await ent.getEntitlement(user.id)).credits).toBe(1);
    expect(await welcomeGrants(user.id)).toBe(1);
  });

  it("an existing account gets nothing when it signs in", async () => {
    const { user } = await createDevSession("welcome3@verdict.local");
    const spent = await ent.reservePremiumVerdict(user.id);
    if (!spent.ok) throw new Error("expected the welcome credit to fund a verdict");
    await ent.consumePremiumVerdict(spent.reservation.id, "v-welcome3");
    await createDevSession("welcome3@verdict.local");
    expect(await ent.getEntitlement(user.id)).toMatchObject({ canUsePremium: false, credits: 0 });
  });

  it("accounts made by the admin script get it too", async () => {
    const res = await findOrCreateUserByEmail("welcome4@example.com", true);
    expect(res?.created).toBe(true);
    expect((await ent.getEntitlement(res!.user.id)).credits).toBe(1);
  });

  it("no_credits once the welcome credit is used", async () => {
    const { user } = await createDevSession("welcome5@verdict.local");
    const first = await ent.reservePremiumVerdict(user.id);
    expect(first).toMatchObject({ ok: true, reservation: { fundedBy: "credits" } });
    if (!first.ok) return;
    await ent.consumePremiumVerdict(first.reservation.id, "v-welcome5");
    expect(await ent.reservePremiumVerdict(user.id)).toEqual({ ok: false, code: "no_credits" });
  });
});
