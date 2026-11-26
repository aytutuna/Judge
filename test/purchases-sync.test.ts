import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-sync-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3600";

const { createDevSession } = await import("../lib/auth");
const ent = await import("../lib/entitlements");
const { POST } = await import("../app/api/v1/me/purchases/sync/route");
const { POST: webhook } = await import("../app/api/v1/webhooks/revenuecat/route");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

async function newUser() {
  const session = await createDevSession(`sync${Date.now()}${++seq}@verdict.local`);
  await ent.revokeAll(session.user.id, { externalId: `reset:${session.user.id}` });
  return session;
}

const hook = (body: unknown) =>
  webhook(
    new Request("http://localhost:3600/api/v1/webhooks/revenuecat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer hook-secret", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify(body),
    }),
  );

const realEvent = (userId: string, type: string, otid: string, over: Record<string, unknown> = {}) => ({
  api_version: "1.0",
  event: {
    id: `evt-${otid}-${type}-${Date.now()}`,
    type,
    app_user_id: userId,
    original_app_user_id: userId,
    product_id: "monthly",
    store: "APP_STORE",
    environment: "PRODUCTION",
    original_transaction_id: otid,
    transaction_id: `${otid}-t`,
    purchased_at_ms: Date.now() - DAY,
    expiration_at_ms: Date.now() + 29 * DAY,
    ...over,
  },
});

async function activePlans(userId: string): Promise<{ id: string; used: number }[]> {
  const { getDb } = await import("../lib/db");
  const rs = await (await getDb()).execute({
    sql: "SELECT original_transaction_id, used_in_period FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY rowid",
    args: [userId],
  });
  return rs.rows.map((r) => ({ id: String(r.original_transaction_id).replace(/^rcsync:.*/, "rcsync"), used: Number(r.used_in_period) }));
}

const call = (token: string) =>
  POST(new Request("http://localhost:3600/api/v1/me/purchases/sync", { method: "POST", headers: { authorization: `Bearer ${token}` } }));

function revenueCat(subscriptions: Record<string, unknown>, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(JSON.stringify({ subscriber: { subscriptions } }), { status, headers: { "content-type": "application/json" } }),
  );
}

const active = (over: Record<string, unknown> = {}) => ({
  store: "app_store",
  purchase_date: new Date(Date.now() - 5 * DAY).toISOString(),
  original_purchase_date: new Date(Date.now() - 65 * DAY).toISOString(),
  expires_date: new Date(Date.now() + 25 * DAY).toISOString(),
  is_sandbox: false,
  unsubscribe_detected_at: null,
  ...over,
});

beforeEach(() => {
  vi.stubEnv("REVENUECAT_API_KEY", "sk_test_key");
  vi.stubEnv("REVENUECAT_WEBHOOK_SECRET", "hook-secret");
  vi.stubEnv("ALLOW_SANDBOX_PURCHASES", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/v1/me/purchases/sync (restore)", () => {
  it("401 signed out, 503 not_configured without the API key", async () => {
    const { token } = await newUser();
    expect((await call("nope")).status).toBe(401);
    vi.stubEnv("REVENUECAT_API_KEY", "");
    const res = await call(token);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "not_configured" });
  });

  it("applies the active plan RevenueCat reports at once, and again changes nothing", async () => {
    const { token, user } = await newUser();
    const fetchMock = revenueCat({ monthly: active() });
    const res = await call(token);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ synced: 1, entitlement: { canUsePremium: true, subscription: { productId: "monthly", source: "app_store" } } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(user.id)}`);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer sk_test_key" });

    expect((await (await call(token)).json()).synced).toBe(0);
    expect((await ent.getEntitlement(user.id)).subscription?.cap).toBe(35);
  });

  it("skips expired, refunded and sandbox plans, packs and unknown products", async () => {
    const { token, user } = await newUser();
    revenueCat({
      monthly: active({ expires_date: new Date(Date.now() - DAY).toISOString() }),
      "monthly:p1m": active({ refunded_at: new Date().toISOString() }),
      other: active(),
      pack_10: active(),
    });
    expect((await (await call(token)).json()).synced).toBe(0);
    revenueCat({ monthly: active({ is_sandbox: true }) });
    expect((await (await call(token)).json()).synced).toBe(0);
    vi.stubEnv("ALLOW_SANDBOX_PURCHASES", "1");
    expect((await (await call(token)).json()).synced).toBe(1);
    expect((await ent.getEntitlement(user.id)).canUsePremium).toBe(true);
  });

  it("does not add a second plan next to one the webhooks already gave the account", async () => {
    const { token, user } = await newUser();
    await ent.grantSubscription({
      userId: user.id,
      source: "app_store",
      externalId: "evt-real",
      originalTransactionId: "otid-real",
      productId: "monthly",
      periodStart: new Date(Date.now() - DAY).toISOString(),
      periodEnd: new Date(Date.now() + 29 * DAY).toISOString(),
      willRenew: true,
    });
    revenueCat({ monthly: active() });
    expect((await (await call(token)).json()).synced).toBe(0);
  });

  it("the real plan replaces the synced one when its first webhook arrives, carrying the usage", async () => {
    const { token, user } = await newUser();
    revenueCat({ monthly: active() });
    await call(token);
    for (let i = 0; i < 3; i++) {
      const r = await ent.reservePremiumVerdict(user.id);
      if (r.ok) await ent.consumePremiumVerdict(r.reservation.id, `v-carry-${i}`);
    }
    expect((await hook(realEvent(user.id, "RENEWAL", "otid-real-1"))).status).toBe(200);
    expect(await activePlans(user.id)).toEqual([{ id: "otid-real-1", used: 3 }]);
  });

  it("a second account restoring the same store subscription gets its own plan", async () => {
    const a = await newUser();
    const b = await newUser();
    revenueCat({ monthly: active() });
    expect((await (await call(a.token)).json()).synced).toBe(1);
    expect((await (await call(b.token)).json()).synced).toBe(1);
  });

  it("TRANSFER after a restore leaves one plan, with the usage of the real one", async () => {
    const a = await newUser();
    const b = await newUser();
    await ent.grantSubscription({
      userId: a.user.id,
      source: "app_store",
      externalId: "evt-tr-real",
      originalTransactionId: "otid-tr-real",
      productId: "monthly",
      periodStart: new Date(Date.now() - DAY).toISOString(),
      periodEnd: new Date(Date.now() + 29 * DAY).toISOString(),
      willRenew: true,
    });
    for (let i = 0; i < 4; i++) {
      const r = await ent.reservePremiumVerdict(a.user.id);
      if (r.ok) await ent.consumePremiumVerdict(r.reservation.id, `v-tr-${i}`);
    }
    revenueCat({ monthly: active() });
    await call(b.token);
    const moved = await hook({
      api_version: "1.0",
      event: { id: `evt-tr-${Date.now()}`, type: "TRANSFER", store: "APP_STORE", environment: "PRODUCTION", transferred_from: [a.user.id], transferred_to: [b.user.id] },
    });
    expect(await moved.json()).toMatchObject({ applied: true, moved: 1 });
    expect(await activePlans(b.user.id)).toEqual([{ id: "otid-tr-real", used: 4 }]);
    expect(await activePlans(a.user.id)).toEqual([]);
  });

  it("a transfer away retires the old account's stand-in", async () => {
    const a = await newUser();
    const b = await newUser();
    revenueCat({ monthly: active() });
    await call(a.token);
    await hook({
      api_version: "1.0",
      event: { id: `evt-away-${Date.now()}`, type: "TRANSFER", store: "APP_STORE", environment: "PRODUCTION", transferred_from: [a.user.id], transferred_to: [b.user.id] },
    });
    expect(await activePlans(a.user.id)).toEqual([]);
  });

  it("refuses while a revoked or refunded plan of that store still covers today", async () => {
    const { token, user } = await newUser();
    await ent.grantSubscription({
      userId: user.id,
      source: "app_store",
      externalId: "evt-rv",
      originalTransactionId: "otid-rv",
      productId: "monthly",
      periodStart: new Date(Date.now() - DAY).toISOString(),
      periodEnd: new Date(Date.now() + 29 * DAY).toISOString(),
      willRenew: true,
    });
    await ent.revokeAll(user.id, { externalId: `rv:${user.id}` });
    revenueCat({ monthly: active() });
    expect((await (await call(token)).json()).synced).toBe(0);
    expect((await ent.getEntitlement(user.id)).canUsePremium).toBe(false);
  });

  it("a refund or an expiry of the real plan ends the stand-in too", async () => {
    const a = await newUser();
    const b = await newUser();
    revenueCat({ monthly: active() });
    await call(a.token);
    await call(b.token);
    const refund = realEvent(a.user.id, "CANCELLATION", "otid-gone", { cancel_reason: "CUSTOMER_SUPPORT" });
    await hook(refund);
    expect((await ent.getEntitlement(a.user.id)).canUsePremium).toBe(false);
    await hook(realEvent(b.user.id, "EXPIRATION", "otid-gone-2", { expiration_at_ms: Date.now() - 1000 }));
    expect((await ent.getEntitlement(b.user.id)).canUsePremium).toBe(false);
  });

  it("skips a plan with a billing issue or a grace period: access ends at the paid period", async () => {
    const { token } = await newUser();
    revenueCat({
      monthly: active({ billing_issues_detected_at: new Date().toISOString() }),
      "monthly:p1m": active({ grace_period_expires_date: new Date(Date.now() + 5 * DAY).toISOString() }),
    });
    expect((await (await call(token)).json()).synced).toBe(0);
  });

  it("carries the stand-in's usage when the real plan lands on an existing row (a resubscriber)", async () => {
    const { token, user } = await newUser();
    await ent.grantSubscription({
      userId: user.id,
      source: "app_store",
      externalId: "evt-old-period",
      originalTransactionId: "otid-resub",
      productId: "monthly",
      periodStart: new Date(Date.now() - 40 * DAY).toISOString(),
      periodEnd: new Date(Date.now() - 10 * DAY).toISOString(),
      willRenew: true,
    });
    revenueCat({ monthly: active() });
    expect((await (await call(token)).json()).synced).toBe(1);
    for (let i = 0; i < 3; i++) {
      const r = await ent.reservePremiumVerdict(user.id);
      if (r.ok) await ent.consumePremiumVerdict(r.reservation.id, `v-resub-${i}`);
    }
    expect((await hook(realEvent(user.id, "RENEWAL", "otid-resub"))).status).toBe(200);
    expect(await activePlans(user.id)).toEqual([{ id: "otid-resub", used: 3 }]);
  });

  it("restore works again for a resubscriber whose earlier stand-in was retired", async () => {
    const { token, user } = await newUser();
    const first = new Date(Date.now() - 65 * DAY).toISOString();
    revenueCat({ monthly: active({ original_purchase_date: first }) });
    expect((await (await call(token)).json()).synced).toBe(1);
    await hook(realEvent(user.id, "EXPIRATION", "otid-first", { expiration_at_ms: Date.now() - 1000 }));
    expect((await ent.getEntitlement(user.id)).canUsePremium).toBe(false);
    revenueCat({ monthly: active({ original_purchase_date: first, purchase_date: new Date(Date.now() - DAY).toISOString() }) });
    expect((await (await call(token)).json()).synced).toBe(1);
    expect((await ent.getEntitlement(user.id)).canUsePremium).toBe(true);
  });

  it("a unit reserved on the stand-in is refunded to the real plan that replaces it", async () => {
    const { token, user } = await newUser();
    revenueCat({ monthly: active() });
    await call(token);
    const held = await ent.reservePremiumVerdict(user.id);
    if (!held.ok) throw new Error("expected a reservation");
    await hook(realEvent(user.id, "RENEWAL", "otid-inflight"));
    expect(await activePlans(user.id)).toEqual([{ id: "otid-inflight", used: 1 }]);
    await ent.refundPremiumVerdict(held.reservation.id); // the run failed
    expect(await activePlans(user.id)).toEqual([{ id: "otid-inflight", used: 0 }]);
  });

  // A stand-in whose period ended 10 days ago, with a unit reserved on it back when it ran.
  async function endedStandIn(userId: string): Promise<{ standIn: string; reservation: string }> {
    const r = await ent.grantRestoredSubscription({
      userId,
      source: "app_store",
      originalTransactionId: `rcsync:${userId}:app_store:monthly:old`,
      externalId: `rcsync:${userId}:app_store:monthly:old`,
      productId: "monthly",
      periodStart: new Date(Date.now() - 40 * DAY).toISOString(),
      periodEnd: new Date(Date.now() - 10 * DAY).toISOString(),
      willRenew: false,
    });
    expect(r.applied).toBe(true);
    const held = await ent.reservePremiumVerdict(userId, { now: new Date(Date.now() - 20 * DAY) });
    if (!held.ok) throw new Error("expected a reservation");
    return { standIn: `rcsync:${userId}:app_store:monthly:old`, reservation: held.reservation.id };
  }

  async function heldOn(reservationId: string): Promise<string> {
    const { getDb } = await import("../lib/db");
    const rs = await (await getDb()).execute({
      sql: "SELECT s.original_transaction_id AS otid FROM premium_usage p JOIN subscriptions s ON s.id = p.subscription_id WHERE p.id = ?",
      args: [reservationId],
    });
    return String(rs.rows[0].otid);
  }

  it("a unit held from an earlier period is not moved onto the next period's plan", async () => {
    const { user } = await newUser();
    const old = await endedStandIn(user.id);
    await hook(realEvent(user.id, "RENEWAL", "otid-next-period"));
    expect(await heldOn(old.reservation)).toBe(old.standIn);
    await ent.refundPremiumVerdict(old.reservation);
    expect(await activePlans(user.id)).toEqual([{ id: "rcsync", used: 0 }, { id: "otid-next-period", used: 0 }]);
  });

  it("the same on a transfer", async () => {
    const a = await newUser();
    const b = await newUser();
    const old = await endedStandIn(b.user.id);
    await ent.grantSubscription({
      userId: a.user.id,
      source: "app_store",
      externalId: "evt-tr-next",
      originalTransactionId: "otid-tr-next",
      productId: "monthly",
      periodStart: new Date(Date.now() - DAY).toISOString(),
      periodEnd: new Date(Date.now() + 29 * DAY).toISOString(),
      willRenew: true,
    });
    await hook({
      api_version: "1.0",
      event: { id: `evt-trn-${Date.now()}`, type: "TRANSFER", store: "APP_STORE", environment: "PRODUCTION", transferred_from: [a.user.id], transferred_to: [b.user.id] },
    });
    expect(await heldOn(old.reservation)).toBe(old.standIn);
  });

  it("a late event for an old period neither retires nor takes the usage of the current stand-in", async () => {
    const { token, user } = await newUser();
    revenueCat({ monthly: active() });
    await call(token);
    for (let i = 0; i < 2; i++) {
      const r = await ent.reservePremiumVerdict(user.id);
      if (r.ok) await ent.consumePremiumVerdict(r.reservation.id, `v-late-${i}`);
    }
    await hook(
      realEvent(user.id, "RENEWAL", "otid-late", { purchased_at_ms: Date.now() - 60 * DAY, expiration_at_ms: Date.now() - 30 * DAY }),
    );
    expect(await activePlans(user.id)).toEqual([
      { id: "rcsync", used: 2 },
      { id: "otid-late", used: 0 },
    ]);
    expect((await ent.getEntitlement(user.id)).canUsePremium).toBe(true);
  });

  it("restore retires the account's stand-ins whose period has ended", async () => {
    const { token, user } = await newUser();
    await endedStandIn(user.id);
    revenueCat({ monthly: active() });
    expect((await (await call(token)).json()).synced).toBe(1);
    expect(await activePlans(user.id)).toEqual([{ id: "rcsync", used: 0 }]);
  });

  it("503 when RevenueCat fails, and nothing is granted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { token, user } = await newUser();
    revenueCat({}, 500);
    expect((await call(token)).status).toBe(503);
    expect((await ent.getEntitlement(user.id)).canUsePremium).toBe(false);
  });
});
