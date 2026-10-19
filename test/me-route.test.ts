import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-me-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3600";

const { createDevSession, sessionCookieHeader } = await import("../lib/auth");
const ent = await import("../lib/entitlements");
const { getDb } = await import("../lib/db");
const { GET, DELETE } = await import("../app/api/v1/me/route");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const URL_ME = "http://localhost:3600/api/v1/me";
const get = (headers: Record<string, string> = {}) => GET(new Request(URL_ME, { headers }));
const del = (headers: Record<string, string>, body: unknown = { confirm: "delete" }) =>
  DELETE(
    new Request(URL_ME, {
      method: "DELETE",
      headers: { "content-type": "application/json", host: "localhost:3600", ...headers },
      body: body === null ? undefined : JSON.stringify(body),
    }),
  );

async function rows(sql: string, args: string[]): Promise<number> {
  const db = await getDb();
  return Number((await db.execute({ sql, args })).rows[0].n);
}

describe("GET /api/v1/me", () => {
  it("signed out: nulls with 200 and no-store", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ user: null, entitlement: null });
  });

  it("signed in: viewer plus entitlement", async () => {
    const { token, user } = await createDevSession("me1@verdict.local");
    await ent.grantCredits({ userId: user.id, credits: 5, source: "admin", externalId: "admin:me1" });
    const res = await get({ authorization: `Bearer ${token}` });
    expect(await res.json()).toEqual({
      user: { id: user.id, email: "me1@verdict.local", name: "Test user", image: null },
      entitlement: { canUsePremium: true, blockedReason: null, credits: 5, subscription: null, resetsAt: null },
    });
  });

  it("503 unavailable when the entitlement lookup fails", async () => {
    const { token } = await createDevSession("me-broken@verdict.local");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const spy = vi.spyOn(ent, "getEntitlement").mockRejectedValueOnce(new Error("db down"));
    const res = await get({ authorization: `Bearer ${token}` });
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "unavailable" });
  });
});

describe("DELETE /api/v1/me", () => {
  it("401 signed out", async () => {
    const res = await del({});
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "signin_required" });
  });

  it("400 without the confirmation body", async () => {
    const { token } = await createDevSession("me2@verdict.local");
    for (const body of [null, {}, { confirm: "yes" }, "delete"]) {
      const res = await del({ authorization: `Bearer ${token}` }, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "invalid" });
    }
  });

  it("403 for a cookie session from a foreign origin; bearer clients are exempt", async () => {
    const { token } = await createDevSession("me3@verdict.local");
    const cookie = (await sessionCookieHeader(token)).split(";")[0];
    const foreign = await del({ cookie, origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ code: "bad_origin" });
    const noOrigin = await del({ cookie });
    expect(noOrigin.status).toBe(403);
    // Still signed in.
    expect((await (await get({ cookie })).json()).user).not.toBeNull();
  });

  it("deletes user, sessions, accounts and entitlements, and clears the cookie", async () => {
    const { token, user } = await createDevSession("me4@verdict.local");
    const second = await createDevSession("me4@verdict.local");
    const db = await getDb();
    await db.execute({
      sql: `INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt)
            VALUES ('acc-me4', 'google-sub', 'google', ?, ?, ?)`,
      args: [user.id, new Date().toISOString(), new Date().toISOString()],
    });
    await ent.grantCredits({ userId: user.id, credits: 3, source: "admin", externalId: "admin:me4" });
    await ent.grantSubscription({
      userId: user.id,
      source: "admin",
      externalId: "admin:me4-sub",
      originalTransactionId: `admin:${user.id}`,
      productId: "monthly",
      periodStart: new Date(Date.now() - 1000).toISOString(),
      periodEnd: new Date(Date.now() + 86_400_000).toISOString(),
      willRenew: false,
    });
    const r = await ent.reservePremiumVerdict(user.id);
    if (!r.ok) throw new Error("expected a reservation");
    await ent.consumePremiumVerdict(r.reservation.id, "verdict-me4");

    const cookie = (await sessionCookieHeader(token)).split(";")[0];
    const res = await del({ cookie, origin: "http://localhost:3600" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    const cleared = res.headers.getSetCookie();
    expect(cleared.some((c) => /^verdict\.session_token=;/.test(c) && /Max-Age=0/.test(c))).toBe(true);

    expect(await rows('SELECT count(*) AS n FROM "user" WHERE id = ?', [user.id])).toBe(0);
    expect(await rows("SELECT count(*) AS n FROM session WHERE userId = ?", [user.id])).toBe(0);
    expect(await rows("SELECT count(*) AS n FROM account WHERE userId = ?", [user.id])).toBe(0);
    for (const t of ["entitlement_accounts", "entitlement_grants", "subscriptions", "premium_usage"]) {
      expect(await rows(`SELECT count(*) AS n FROM ${t} WHERE user_id = ?`, [user.id]), t).toBe(0);
    }
    // Every session of the user is gone, including other devices.
    expect(await (await get({ authorization: `Bearer ${second.token}` })).json()).toEqual({
      user: null,
      entitlement: null,
    });
  });

  it("a bearer client (the app) can delete its account", async () => {
    const { token, user } = await createDevSession("me5@verdict.local");
    const res = await del({ authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(await rows('SELECT count(*) AS n FROM "user" WHERE id = ?', [user.id])).toBe(0);
  });
});
