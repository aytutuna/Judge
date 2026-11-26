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

  it("the real plan replaces the synced one when its first webhook arrives, so the cap is not doubled", async () => {
    const { token, user } = await newUser();
    revenueCat({ monthly: active() });
    await call(token);
    const hook = await webhook(
      new Request("http://localhost:3600/api/v1/webhooks/revenuecat", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer hook-secret", "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify({
          api_version: "1.0",
          event: {
            id: `evt-${Date.now()}`,
            type: "RENEWAL",
            app_user_id: user.id,
            original_app_user_id: user.id,
            product_id: "monthly",
            store: "APP_STORE",
            environment: "PRODUCTION",
            original_transaction_id: "otid-real-1",
            transaction_id: "tx-real-1",
            purchased_at_ms: Date.now() - DAY,
            expiration_at_ms: Date.now() + 29 * DAY,
          },
        }),
      }),
    );
    expect(hook.status).toBe(200);
    const { getDb } = await import("../lib/db");
    const rs = await (await getDb()).execute({
      sql: "SELECT original_transaction_id FROM subscriptions WHERE user_id = ? AND status = 'active'",
      args: [user.id],
    });
    expect(rs.rows.map((r) => String(r.original_transaction_id))).toEqual(["otid-real-1"]);
  });

  it("503 when RevenueCat fails, and nothing is granted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { token, user } = await newUser();
    revenueCat({}, 500);
    expect((await call(token)).status).toBe(503);
    expect((await ent.getEntitlement(user.id)).canUsePremium).toBe(false);
  });
});
