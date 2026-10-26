import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-rc-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3600";

const { createDevSession } = await import("../lib/auth");
const ent = await import("../lib/entitlements");
const { POST } = await import("../app/api/v1/webhooks/revenuecat/route");
const { GET: getMe } = await import("../app/api/v1/me/route");
const { mapRevenueCatEvent, revenueCatAuthorized } = await import("../lib/revenuecat");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const SECRET = "rc-webhook-secret-0123456789";
const URL_HOOK = "http://localhost:3600/api/v1/webhooks/revenuecat";
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.stubEnv("REVENUECAT_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("ALLOW_SANDBOX_PURCHASES", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Body = Record<string, unknown>;

function post(body: unknown, opts: { auth?: string | null; ip?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? "203.0.113.7" };
  const auth = opts.auth === undefined ? `Bearer ${SECRET}` : opts.auth;
  if (auth !== null) headers.authorization = auth;
  return POST(new Request(URL_HOOK, { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) }));
}

async function send(body: unknown, opts: Parameters<typeof post>[1] = {}) {
  const res = await post(body, opts);
  return { status: res.status, json: (await res.json()) as Body };
}

let seq = 0;
const uid = () => `${Date.now()}-${++seq}`;

/** A RevenueCat webhook body (shape from RevenueCat's event reference). */
function rc(over: Body): { api_version: string; event: Body } {
  return {
    api_version: "1.0",
    event: {
      id: `evt-${uid()}`,
      type: "NON_RENEWING_PURCHASE",
      app_id: "app123",
      aliases: [],
      product_id: "pack_10",
      entitlement_ids: null,
      period_type: "NORMAL",
      store: "APP_STORE",
      environment: "PRODUCTION",
      event_timestamp_ms: Date.now(),
      purchased_at_ms: Date.now() - 1000,
      expiration_at_ms: null,
      transaction_id: `tx-${uid()}`,
      original_transaction_id: `otx-${uid()}`,
      is_family_share: false,
      country_code: "US",
      currency: "USD",
      price: 7.5,
      ...over,
    },
  };
}

async function newUser() {
  const n = uid().replace(/[^0-9]/g, "");
  return createDevSession(`rc${n}@verdict.local`);
}

const userFields = (id: string) => ({ app_user_id: id, original_app_user_id: id });

describe("POST /api/v1/webhooks/revenuecat: configuration and auth", () => {
  it("503 not_configured when REVENUECAT_WEBHOOK_SECRET is unset", async () => {
    vi.stubEnv("REVENUECAT_WEBHOOK_SECRET", "");
    const { status, json } = await send(rc({ type: "TEST" }));
    expect(status).toBe(503);
    expect(json).toMatchObject({ code: "not_configured" });
  });

  it("401 without or with a wrong Authorization header", async () => {
    for (const auth of [null, "", "Bearer", `Bearer ${SECRET}x`, `Basic ${SECRET}`, "Bearer wrong"]) {
      const { status, json } = await send(rc({ type: "TEST" }), { auth });
      expect(status, String(auth)).toBe(401);
      expect(json).toMatchObject({ code: "signin_required" });
    }
  });

  it("accepts `Bearer <secret>` (any case) or the bare secret", async () => {
    for (const auth of [`Bearer ${SECRET}`, `bearer ${SECRET}`, SECRET]) {
      const { status } = await send(rc({ type: "TEST" }), { auth });
      expect(status, auth).toBe(200);
    }
    expect(revenueCatAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(revenueCatAuthorized(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
  });

  it("TEST event: 200 { ok, test }", async () => {
    const { status, json } = await send(rc({ type: "TEST", environment: "SANDBOX" }));
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, test: true });
  });

  it("400 for a body that is not a webhook event, 413 past the size cap", async () => {
    expect((await send(null, { raw: "{not json" })).status).toBe(400);
    expect((await send({ hello: 1 })).status).toBe(400);
    expect((await send({ event: { type: "RENEWAL" } })).status).toBe(400);
    const big = JSON.stringify(rc({ subscriber_attributes: { x: { value: "a".repeat(300 * 1024) } } }));
    const { status, json } = await send(null, { raw: big });
    expect(status).toBe(413);
    expect(json).toMatchObject({ code: "too_large" });
    const declared = await POST(
      new Request(URL_HOOK, {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}`, "content-length": String(1024 * 1024) },
        body: "{}",
      }),
    );
    expect(declared.status).toBe(413);
  });

  it("rate limits per IP: 600 per 10 minutes, then 429 with Retry-After; forged requests do not count", async () => {
    const ip = "198.51.100.42";
    for (let i = 0; i < 50; i++) expect((await post(rc({ type: "TEST" }), { ip, auth: "Bearer nope" })).status).toBe(401);
    for (let i = 0; i < 600; i++) {
      const res = await post(rc({ type: "TEST" }), { ip });
      expect(res.status).toBe(200);
    }
    const res = await post(rc({ type: "TEST" }), { ip });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await res.json()).toMatchObject({ code: "rate_limited" });
    expect((await post(rc({ type: "TEST" }), { ip: "198.51.100.43" })).status).toBe(200);
  });
});

describe("POST /api/v1/webhooks/revenuecat: credit packs", () => {
  it("NON_RENEWING_PURCHASE grants the pack once per transaction; /me shows it", async () => {
    const { user, token } = await newUser();
    const purchase = rc({ ...userFields(user.id), product_id: "pack_10", transaction_id: "tx-pack-a" });
    const first = await send(purchase);
    expect(first).toEqual({ status: 200, json: { ok: true, applied: true, action: "credits_purchased" } });
    // RevenueCat retry (same event id): no-op.
    expect((await send(purchase)).json).toEqual({ ok: true, applied: false, action: "credits_purchased" });
    // Another event for the same store transaction: still no-op.
    const again = rc({ ...userFields(user.id), type: "INITIAL_PURCHASE", product_id: "pack_10", transaction_id: "tx-pack-a" });
    expect((await send(again)).json).toMatchObject({ applied: false });
    expect((await ent.getEntitlement(user.id)).credits).toBe(10);

    const me = await getMe(new Request("http://localhost:3600/api/v1/me", { headers: { authorization: `Bearer ${token}` } }));
    expect(await me.json()).toMatchObject({
      user: { id: user.id },
      entitlement: { canUsePremium: true, credits: 10, subscription: null },
    });
  });

  it("Play Store and Stripe purchases grant the pack", async () => {
    const { user } = await newUser();
    await send(rc({ ...userFields(user.id), product_id: "pack_1", store: "PLAY_STORE" }));
    expect((await ent.getEntitlement(user.id)).credits).toBe(1);
    await send(rc({ ...userFields(user.id), product_id: "pack_10", store: "STRIPE" }));
    expect((await ent.getEntitlement(user.id)).credits).toBe(11);
  });

  it("a refund (CANCELLATION, CUSTOMER_SUPPORT) takes the credits back once", async () => {
    const { user } = await newUser();
    await send(rc({ ...userFields(user.id), product_id: "pack_10", transaction_id: "tx-refund-a" }));
    await send(rc({ ...userFields(user.id), product_id: "pack_1", transaction_id: "tx-refund-b" }));
    expect((await ent.getEntitlement(user.id)).credits).toBe(11);
    const refund = rc({
      ...userFields(user.id),
      type: "CANCELLATION",
      cancel_reason: "CUSTOMER_SUPPORT",
      product_id: "pack_10",
      transaction_id: "tx-refund-a",
      price: -7.5,
    });
    expect((await send(refund)).json).toEqual({ ok: true, applied: true, action: "refund" });
    expect((await send(refund)).json).toMatchObject({ applied: false });
    // A second refund event for the same purchase changes nothing either.
    expect((await send({ ...refund, event: { ...refund.event, id: `evt-${uid()}` } })).json).toMatchObject({ applied: false });
    expect((await ent.getEntitlement(user.id)).credits).toBe(1);
  });

  it("a pack CANCELLATION that is not a refund is ignored", async () => {
    const { user } = await newUser();
    await send(rc({ ...userFields(user.id), transaction_id: "tx-cancel-x" }));
    const { status, json } = await send(
      rc({ ...userFields(user.id), type: "CANCELLATION", cancel_reason: "UNKNOWN", transaction_id: "tx-cancel-x" }),
    );
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, ignored: true, reason: "cancellation_not_refund" });
    expect((await ent.getEntitlement(user.id)).credits).toBe(10);
  });
});

describe("POST /api/v1/webhooks/revenuecat: monthly plan", () => {
  it("purchase, renewal, cancellation, un-cancellation and expiration", async () => {
    const { user } = await newUser();
    const otid = `otid-${uid()}`;
    const start = Date.now() - 20 * DAY;
    const end = start + 30 * DAY;
    const sub = (over: Body) =>
      rc({
        ...userFields(user.id),
        product_id: "monthly:monthly-base",
        store: "PLAY_STORE",
        original_transaction_id: otid,
        purchased_at_ms: start,
        expiration_at_ms: end,
        ...over,
      });

    const initial = sub({ type: "INITIAL_PURCHASE", transaction_id: `${otid}-0` });
    expect((await send(initial)).json).toEqual({ ok: true, applied: true, action: "subscription_active" });
    expect((await send(initial)).json).toMatchObject({ applied: false });
    let e = await ent.getEntitlement(user.id);
    expect(e.canUsePremium).toBe(true);
    expect(e.subscription).toMatchObject({
      source: "play_store",
      productId: "monthly",
      periodStart: new Date(start).toISOString(),
      periodEnd: new Date(end).toISOString(),
      willRenew: true,
      used: 0,
      cap: 35,
    });

    // Use one unit, then renew into a new period: usage resets.
    const r = await ent.reservePremiumVerdict(user.id);
    expect(r).toMatchObject({ ok: true, reservation: { fundedBy: "subscription" } });
    if (r.ok) await ent.consumePremiumVerdict(r.reservation.id, "v1");
    expect((await ent.getEntitlement(user.id)).subscription?.used).toBe(1);

    const start2 = Date.now() - 1000;
    const end2 = start2 + 30 * DAY;
    const renewal = sub({ type: "RENEWAL", transaction_id: `${otid}-1`, purchased_at_ms: start2, expiration_at_ms: end2 });
    expect((await send(renewal)).json).toMatchObject({ applied: true, action: "subscription_active" });
    expect((await send(renewal)).json).toMatchObject({ applied: false });
    e = await ent.getEntitlement(user.id);
    expect(e.subscription).toMatchObject({
      periodStart: new Date(start2).toISOString(),
      periodEnd: new Date(end2).toISOString(),
      used: 0,
    });

    const cancel = sub({ type: "CANCELLATION", cancel_reason: "UNSUBSCRIBE", purchased_at_ms: start2, expiration_at_ms: end2 });
    expect((await send(cancel)).json).toEqual({ ok: true, applied: true, action: "subscription_will_not_renew" });
    expect((await send(cancel)).json).toMatchObject({ applied: false });
    e = await ent.getEntitlement(user.id);
    expect(e.subscription).toMatchObject({ willRenew: false });
    expect(e.canUsePremium).toBe(true);

    if (r.ok) expect(await ent.reservePremiumVerdict(user.id)).toMatchObject({ ok: true });
    const uncancel = sub({ type: "UNCANCELLATION", purchased_at_ms: start2, expiration_at_ms: end2 });
    expect((await send(uncancel)).json).toMatchObject({ applied: true, action: "subscription_active" });
    // Same period: the fair-use count is kept.
    expect((await ent.getEntitlement(user.id)).subscription).toMatchObject({ willRenew: true, used: 1 });

    const expire = sub({ type: "EXPIRATION", expiration_reason: "UNSUBSCRIBE", expiration_at_ms: Date.now() - 1000 });
    expect((await send(expire)).json).toEqual({ ok: true, applied: true, action: "subscription_expired" });
    expect((await send(expire)).json).toMatchObject({ applied: false });
    e = await ent.getEntitlement(user.id);
    expect(e.subscription).toBeNull();
    expect(e.canUsePremium).toBe(false);
  });

  it("PRODUCT_CHANGE to another base plan keeps the plan; a refund ends the plan at once", async () => {
    const { user } = await newUser();
    const otid = `otid-${uid()}`;
    const base = {
      ...userFields(user.id),
      store: "APP_STORE",
      original_transaction_id: otid,
      purchased_at_ms: Date.now() - 1000,
      expiration_at_ms: Date.now() + 30 * DAY,
    };
    await send(rc({ ...base, type: "INITIAL_PURCHASE", product_id: "monthly" }));
    const change = rc({ ...base, type: "PRODUCT_CHANGE", product_id: "monthly", new_product_id: "monthly:p1m" });
    expect((await send(change)).json).toMatchObject({ applied: true, action: "subscription_active" });
    expect((await ent.getEntitlement(user.id)).subscription).toMatchObject({ productId: "monthly" });

    const refund = rc({ ...base, type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT", product_id: "monthly:p1m" });
    expect((await send(refund)).json).toEqual({ ok: true, applied: true, action: "refund" });
    expect((await send(refund)).json).toMatchObject({ applied: false });
    const e = await ent.getEntitlement(user.id);
    expect(e.subscription).toBeNull();
    expect(e.canUsePremium).toBe(false);
  });

  it("events for a subscription nobody has are answered 200 and change nothing", async () => {
    const { json } = await send(
      rc({ type: "EXPIRATION", product_id: "monthly", original_transaction_id: "otid-none", expiration_at_ms: Date.now() }),
    );
    expect(json).toEqual({ ok: true, applied: false, action: "subscription_expired" });
  });
});

describe("POST /api/v1/webhooks/revenuecat: ignored events", () => {
  it("unknown product, unknown or anonymous user, unsupported store", async () => {
    const { user } = await newUser();
    expect((await send(rc({ ...userFields(user.id), product_id: "lifetime_unlock" }))).json).toEqual({
      ok: true,
      ignored: true,
      reason: "unknown_product",
    });
    expect((await send(rc({ ...userFields("no-such-user"), product_id: "pack_10" }))).json).toEqual({
      ok: true,
      ignored: true,
      reason: "unknown_user",
    });
    const anon = "$RCAnonymousID:abc123";
    expect((await send(rc({ app_user_id: anon, original_app_user_id: anon, aliases: [anon] }))).json).toMatchObject({
      ignored: true,
      reason: "unknown_user",
    });
    const subForNobody = rc({
      ...userFields("no-such-user"),
      type: "INITIAL_PURCHASE",
      product_id: "monthly",
      expiration_at_ms: Date.now() + 30 * DAY,
    });
    expect((await send(subForNobody)).json).toEqual({ ok: true, ignored: true, reason: "unknown_user" });
    expect((await send(rc({ ...userFields(user.id), store: "AMAZON" }))).json).toMatchObject({
      ignored: true,
      reason: "unsupported_store",
    });
    expect((await ent.getEntitlement(user.id)).credits).toBe(0);
  });

  it("finds the account among the aliases when app_user_id is anonymous", async () => {
    const { user } = await newUser();
    const anon = "$RCAnonymousID:def456";
    await send(rc({ app_user_id: anon, original_app_user_id: anon, aliases: [anon, user.id] }));
    expect((await ent.getEntitlement(user.id)).credits).toBe(10);
  });

  it("SANDBOX events only with ALLOW_SANDBOX_PURCHASES=1", async () => {
    const { user } = await newUser();
    const sandbox = rc({ ...userFields(user.id), environment: "SANDBOX", transaction_id: `tx-sb-${uid()}` });
    expect((await send(sandbox)).json).toEqual({ ok: true, ignored: true, reason: "sandbox" });
    expect((await ent.getEntitlement(user.id)).credits).toBe(0);
    vi.stubEnv("ALLOW_SANDBOX_PURCHASES", "1");
    expect((await send(sandbox)).json).toMatchObject({ applied: true, action: "credits_purchased" });
    expect((await ent.getEntitlement(user.id)).credits).toBe(10);
  });

  it("BILLING_ISSUE, SUBSCRIPTION_PAUSED, TRANSFER and other types change nothing", async () => {
    const cases: [string, string][] = [
      ["BILLING_ISSUE", "billing_issue"],
      ["SUBSCRIPTION_PAUSED", "subscription_paused"],
      ["TRANSFER", "transfer_not_supported"],
      ["REFUND_REVERSED", "unhandled_type"],
      ["SUBSCRIPTION_EXTENDED", "unhandled_type"],
    ];
    for (const [type, reason] of cases) {
      expect((await send(rc({ type, product_id: "monthly" }))).json, type).toEqual({ ok: true, ignored: true, reason });
    }
  });

  it("503 when applying fails, so RevenueCat retries", async () => {
    const { user } = await newUser();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(ent, "applyStoreEvent").mockRejectedValueOnce(new Error("SQLITE_BUSY"));
    const purchase = rc({ ...userFields(user.id), transaction_id: `tx-retry-${uid()}` });
    const failed = await send(purchase);
    expect(failed.status).toBe(503);
    expect(failed.json).toMatchObject({ code: "unavailable" });
    expect((await send(purchase)).json).toMatchObject({ applied: true });
    expect((await ent.getEntitlement(user.id)).credits).toBe(10);
  });
});

describe("mapRevenueCatEvent", () => {
  const map = (over: Body) => mapRevenueCatEvent(rc({ app_user_id: "u1", ...over }), { allowSandbox: false });

  it("maps a pack purchase to credits_purchased keyed by transaction_id", () => {
    const out = map({ id: "e1", transaction_id: "t1", product_id: "pack_10", quantity: 2 });
    expect(out.kind).toBe("grant");
    if (out.kind !== "grant") return;
    expect(out.userIds).toEqual(["u1"]);
    expect(out.event("u1")).toEqual({
      type: "credits_purchased",
      eventId: "e1",
      source: "app_store",
      userId: "u1",
      productId: "pack_10",
      credits: 20,
      transactionId: "t1",
    });
  });

  it("clamps quantity to 1..100 and falls back to event_timestamp_ms for an expiry", () => {
    for (const [quantity, credits] of [[0, 10], [101, 10], [1.5, 10], ["3", 10], [100, 1000]] as const) {
      const out = map({ quantity });
      expect(out.kind === "grant" && out.event("u1"), String(quantity)).toMatchObject({ credits });
    }
    const at = Date.UTC(2026, 0, 2);
    expect(map({ type: "EXPIRATION", product_id: "monthly", expiration_at_ms: null, event_timestamp_ms: at })).toMatchObject({
      kind: "apply",
      event: { type: "subscription_expired", at: new Date(at).toISOString() },
    });
  });

  it("refuses incomplete subscription periods and prototype keys", () => {
    expect(map({ type: "RENEWAL", product_id: "monthly", expiration_at_ms: null })).toEqual({
      kind: "ignored",
      reason: "missing_fields",
    });
    expect(
      map({ type: "INITIAL_PURCHASE", product_id: "monthly", original_transaction_id: null, expiration_at_ms: Date.now() + DAY }),
    ).toEqual({ kind: "ignored", reason: "missing_fields" });
    expect(map({ type: "NON_RENEWING_PURCHASE", transaction_id: "" })).toEqual({ kind: "ignored", reason: "missing_fields" });
    expect(map({ product_id: "constructor" })).toEqual({ kind: "ignored", reason: "unknown_product" });
    expect(map({ store: "constructor" })).toEqual({ kind: "ignored", reason: "unsupported_store" });
    expect(map({ type: "RENEWAL", product_id: "pack_10" })).toEqual({ kind: "ignored", reason: "wrong_product_kind" });
    expect(map({ type: "NON_RENEWING_PURCHASE", product_id: "monthly" })).toEqual({
      kind: "ignored",
      reason: "wrong_product_kind",
    });
  });
});
