import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-ent-"));
const url = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
// lib/db reads DATABASE_URL when first used, so set it before importing.
process.env.DATABASE_URL = url;
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

let seq = 0;
const newUser = () => `user-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const DAY = 24 * 60 * 60 * 1000;

async function credits(userId: string, n: number, externalId = `admin:${userId}:${n}:${Math.random()}`) {
  return ent.grantCredits({ userId, credits: n, source: "admin", externalId });
}

async function subscribe(userId: string, opts: { start?: Date; days?: number; cap?: number; otid?: string; ext?: string } = {}) {
  const start = opts.start ?? new Date(Date.now() - 1000);
  return ent.grantSubscription({
    userId,
    source: "app_store",
    externalId: opts.ext ?? `evt-${Math.random()}`,
    originalTransactionId: opts.otid ?? `otid-${userId}`,
    productId: "monthly",
    periodStart: start.toISOString(),
    periodEnd: new Date(start.getTime() + (opts.days ?? 30) * DAY).toISOString(),
    willRenew: true,
    cap: opts.cap,
  });
}

async function count(table: string, userId: string): Promise<number> {
  const db = await getDb();
  const rs = await db.execute({ sql: `SELECT count(*) AS n FROM ${table} WHERE user_id = ?`, args: [userId] });
  return Number(rs.rows[0].n);
}

describe("entitlements: state", () => {
  it("a user with nothing is out of credits", async () => {
    const e = await ent.getEntitlement(newUser());
    expect(e).toEqual({
      canUsePremium: false,
      blockedReason: "no_credits",
      credits: 0,
      subscription: null,
      resetsAt: null,
    });
  });

  it("credits make premium usable; spending them all gives no_credits", async () => {
    const u = newUser();
    await credits(u, 1);
    expect((await ent.getEntitlement(u)).canUsePremium).toBe(true);
    const r = await ent.reservePremiumVerdict(u);
    expect(r).toMatchObject({ ok: true, reservation: { fundedBy: "credits" } });
    const e = await ent.getEntitlement(u);
    expect(e).toMatchObject({ canUsePremium: false, blockedReason: "no_credits", credits: 0 });
    expect(await ent.reservePremiumVerdict(u)).toEqual({ ok: false, code: "no_credits" });
  });

  it("users who never bought anything are refused with no_credits", async () => {
    expect(await ent.reservePremiumVerdict(newUser())).toEqual({ ok: false, code: "no_credits" });
  });
});

describe("entitlements: reservations", () => {
  it("8 concurrent reserves on 3 credits: exactly 3 succeed", async () => {
    const u = newUser();
    await credits(u, 3);
    const results = await Promise.all(Array.from({ length: 8 }, () => ent.reservePremiumVerdict(u)));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok && r.code === "no_credits")).toHaveLength(5);
    expect((await ent.getEntitlement(u)).credits).toBe(0);
    expect(await count("premium_usage", u)).toBe(3);
  });

  it("concurrent reserves from a second database connection never overspend", async () => {
    const u = newUser();
    await credits(u, 4);
    // A second client on the same file stands in for another process
    // (scripts/grant.ts) writing at the same time.
    const other = createClient({ url });
    try {
      const results = await Promise.all([
        ...Array.from({ length: 6 }, () => ent.reservePremiumVerdict(u)),
        (async () => {
          for (let i = 0; ; i++) {
            try {
              return await other.execute({
                sql: "UPDATE entitlement_accounts SET credits = credits + 1 WHERE user_id = ?",
                args: [u],
              });
            } catch (e) {
              if (i > 50 || !/SQLITE_BUSY|locked/i.test(String(e))) throw e;
              await new Promise((r) => setTimeout(r, 20));
            }
          }
        })(),
      ]);
      const oks = results.filter((r) => "ok" in r && r.ok).length;
      const left = (await ent.getEntitlement(u)).credits;
      expect(oks + left).toBe(5);
      expect(left).toBeGreaterThanOrEqual(0);
    } finally {
      other.close();
    }
  });

  it("funds from the subscription first, then credits", async () => {
    const u = newUser();
    await credits(u, 2);
    await subscribe(u, { cap: 2 });
    const a = await ent.reservePremiumVerdict(u);
    const b = await ent.reservePremiumVerdict(u);
    const c = await ent.reservePremiumVerdict(u);
    expect([a, b, c].map((r) => (r.ok ? r.reservation.fundedBy : r.code))).toEqual([
      "subscription",
      "subscription",
      "credits",
    ]);
    const e = await ent.getEntitlement(u);
    expect(e.credits).toBe(1);
    expect(e.subscription).toMatchObject({ used: 2, cap: 2, source: "app_store", willRenew: true });
    expect(e.canUsePremium).toBe(true);
  });

  it("fair use: at the cap with no credits, then a pack tops it up", async () => {
    const u = newUser();
    await subscribe(u, { cap: 1 });
    expect((await ent.reservePremiumVerdict(u)).ok).toBe(true);
    const blocked = await ent.reservePremiumVerdict(u);
    const e = await ent.getEntitlement(u);
    expect(e.blockedReason).toBe("fair_use");
    expect(e.resetsAt).toBe(e.subscription!.periodEnd);
    expect(blocked).toEqual({ ok: false, code: "fair_use", resetsAt: e.subscription!.periodEnd });
    await credits(u, 1);
    expect(await ent.reservePremiumVerdict(u)).toMatchObject({ ok: true, reservation: { fundedBy: "credits" } });
  });

  it("refund returns the unit to its source; consume and refund are idempotent", async () => {
    const u = newUser();
    await credits(u, 1);
    await subscribe(u, { cap: 1 });
    const s = await ent.reservePremiumVerdict(u);
    const c = await ent.reservePremiumVerdict(u);
    if (!s.ok || !c.ok) throw new Error("expected two reservations");
    await ent.refundPremiumVerdict(s.reservation.id);
    await ent.refundPremiumVerdict(s.reservation.id);
    let e = await ent.getEntitlement(u);
    expect(e.subscription!.used).toBe(0);
    expect(e.credits).toBe(0);
    await ent.refundPremiumVerdict(c.reservation.id);
    e = await ent.getEntitlement(u);
    expect(e.credits).toBe(1);

    const again = await ent.reservePremiumVerdict(u);
    if (!again.ok) throw new Error("expected a reservation");
    await ent.consumePremiumVerdict(again.reservation.id, "verdict001");
    await ent.consumePremiumVerdict(again.reservation.id, "verdict002");
    await ent.refundPremiumVerdict(again.reservation.id); // consumed: no-op
    e = await ent.getEntitlement(u);
    expect(e.subscription!.used).toBe(1);
    const db = await getDb();
    const row = await db.execute({
      sql: "SELECT status, verdict_id FROM premium_usage WHERE id = ?",
      args: [again.reservation.id],
    });
    expect(row.rows[0]).toMatchObject({ status: "consumed", verdict_id: "verdict001" });
  });

  it("a subscription refund after the period changed does not touch the new period", async () => {
    const u = newUser();
    const start = new Date(Date.now() - 2000);
    await subscribe(u, { start, cap: 5 });
    const r = await ent.reservePremiumVerdict(u);
    if (!r.ok) throw new Error("expected a reservation");
    // Renewal: a new period begins (usage resets to 0)...
    await subscribe(u, { start: new Date(start.getTime() + 1000), cap: 5 });
    expect((await ent.getEntitlement(u)).subscription!.used).toBe(0);
    // ...one verdict in the new period...
    expect((await ent.reservePremiumVerdict(u)).ok).toBe(true);
    // ...and the old reservation's refund must not decrement it.
    await ent.refundPremiumVerdict(r.reservation.id);
    expect((await ent.getEntitlement(u)).subscription!.used).toBe(1);
  });

  it("Idempotency-Key: in_progress while reserved, replay once consumed, reusable after refund", async () => {
    const u = newUser();
    await credits(u, 3);
    const first = await ent.reservePremiumVerdict(u, { idempotencyKey: "key-1" });
    if (!first.ok) throw new Error("expected a reservation");
    expect(await ent.reservePremiumVerdict(u, { idempotencyKey: "key-1" })).toEqual({ ok: false, code: "in_progress" });
    await ent.consumePremiumVerdict(first.reservation.id, "verdictABC");
    expect(await ent.reservePremiumVerdict(u, { idempotencyKey: "key-1" })).toEqual({
      ok: false,
      code: "replay",
      verdictId: "verdictABC",
    });
    expect((await ent.getEntitlement(u)).credits).toBe(2);

    const second = await ent.reservePremiumVerdict(u, { idempotencyKey: "key-2" });
    if (!second.ok) throw new Error("expected a reservation");
    await ent.refundPremiumVerdict(second.reservation.id);
    const retry = await ent.reservePremiumVerdict(u, { idempotencyKey: "key-2" });
    expect(retry.ok).toBe(true);
    expect((await ent.getEntitlement(u)).credits).toBe(1);
  });

  it("concurrent requests with the same key reserve once", async () => {
    const u = newUser();
    await credits(u, 5);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => ent.reservePremiumVerdict(u, { idempotencyKey: "same" })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === "in_progress")).toHaveLength(3);
    expect((await ent.getEntitlement(u)).credits).toBe(4);
  });

  it("sweeps reservations left reserved for over 10 minutes", async () => {
    const u = newUser();
    await credits(u, 1);
    const r = await ent.reservePremiumVerdict(u);
    if (!r.ok) throw new Error("expected a reservation");
    expect(await ent.sweepStaleReservations(new Date(Date.now() + 5 * 60_000))).toBe(0);
    const swept = await ent.sweepStaleReservations(new Date(Date.now() + 11 * 60_000));
    expect(swept).toBeGreaterThanOrEqual(1);
    expect((await ent.getEntitlement(u)).credits).toBe(1);
    await ent.consumePremiumVerdict(r.reservation.id, "late"); // refunded: no-op
    expect((await ent.getEntitlement(u)).credits).toBe(1);
  });

  it("counts today's premium runs, refunded ones included (they still cost model calls)", async () => {
    const before = await ent.countPremiumToday();
    const u = newUser();
    await credits(u, 2);
    const a = await ent.reservePremiumVerdict(u);
    const b = await ent.reservePremiumVerdict(u);
    if (!a.ok || !b.ok) throw new Error("expected reservations");
    await ent.refundPremiumVerdict(b.reservation.id);
    expect(await ent.countPremiumToday()).toBe(before + 2);
  });
});

describe("entitlements: grants and store events", () => {
  it("a duplicate externalId applies once", async () => {
    const u = newUser();
    expect(await credits(u, 5, "admin:dup-1")).toEqual({ applied: true });
    expect(await credits(u, 5, "admin:dup-1")).toEqual({ applied: false });
    expect((await ent.getEntitlement(u)).credits).toBe(5);
  });

  it("refund deducts what was granted, clamped at the balance, once", async () => {
    const u = newUser();
    await ent.applyStoreEvent({
      type: "credits_purchased",
      eventId: "rc-1",
      source: "play_store",
      userId: u,
      productId: "pack_10",
      credits: 10,
      transactionId: "GPA.1",
    });
    // The same purchase reported again (another event id) is not granted twice.
    expect(
      await ent.applyStoreEvent({
        type: "credits_purchased",
        eventId: "rc-1b",
        source: "play_store",
        userId: u,
        productId: "pack_10",
        credits: 10,
        transactionId: "GPA.1",
      }),
    ).toEqual({ applied: false });
    for (let i = 0; i < 7; i++) expect((await ent.reservePremiumVerdict(u)).ok).toBe(true);
    expect((await ent.getEntitlement(u)).credits).toBe(3);
    expect(
      await ent.applyStoreEvent({ type: "refund", eventId: "rc-2", source: "play_store", transactionId: "GPA.1" }),
    ).toEqual({ applied: true });
    expect((await ent.getEntitlement(u)).credits).toBe(0);
    // A second refund event for the same purchase changes nothing.
    await ent.grantCredits({ userId: u, credits: 2, source: "admin", externalId: `admin:${u}:after` });
    expect(
      await ent.applyStoreEvent({ type: "refund", eventId: "rc-3", source: "play_store", transactionId: "GPA.1" }),
    ).toEqual({ applied: false });
    expect((await ent.getEntitlement(u)).credits).toBe(2);
  });

  it("subscription lifecycle: active, will not renew, renew, expire, out-of-order expire", async () => {
    const u = newUser();
    const start = new Date(Date.now() - DAY);
    const end = new Date(start.getTime() + 30 * DAY);
    const base = { source: "app_store" as const, originalTransactionId: "1000001" };
    await ent.applyStoreEvent({
      type: "subscription_active",
      eventId: "e1",
      userId: u,
      productId: "monthly",
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      willRenew: true,
      ...base,
    });
    let e = await ent.getEntitlement(u);
    expect(e.subscription).toMatchObject({ willRenew: true, cap: 35, used: 0, periodEnd: end.toISOString() });

    await ent.applyStoreEvent({ type: "subscription_will_not_renew", eventId: "e2", ...base });
    e = await ent.getEntitlement(u);
    expect(e.subscription?.willRenew).toBe(false);
    expect(e.canUsePremium).toBe(true);

    // An expiration event for a period that a renewal already replaced is ignored.
    const renewedStart = new Date(Date.now() - 1000);
    await ent.applyStoreEvent({
      type: "subscription_active",
      eventId: "e3",
      userId: u,
      productId: "monthly",
      periodStart: renewedStart.toISOString(),
      periodEnd: new Date(renewedStart.getTime() + 30 * DAY).toISOString(),
      willRenew: true,
      ...base,
    });
    await ent.applyStoreEvent({ type: "subscription_expired", eventId: "e4", at: start.toISOString(), ...base });
    expect((await ent.getEntitlement(u)).subscription).not.toBeNull();

    await ent.applyStoreEvent({ type: "subscription_expired", eventId: "e5", at: new Date().toISOString(), ...base });
    e = await ent.getEntitlement(u);
    expect(e.subscription).toBeNull();
    expect(e.blockedReason).toBe("no_credits");
    // Duplicate events are no-ops.
    expect(await ent.applyStoreEvent({ type: "subscription_expired", eventId: "e5", at: new Date().toISOString(), ...base })).toEqual({
      applied: false,
    });
  });

  it("a subscription refund ends premium at once", async () => {
    const u = newUser();
    await subscribe(u, { otid: `refund-${u}` });
    expect((await ent.getEntitlement(u)).canUsePremium).toBe(true);
    expect(
      await ent.refundPurchase({ source: "app_store", externalId: `r-${u}`, transactionId: `refund-${u}` }),
    ).toEqual({ applied: true });
    expect((await ent.getEntitlement(u)).canUsePremium).toBe(false);
  });

  it("an unknown transaction refund applies nothing", async () => {
    expect(await ent.refundPurchase({ source: "web", externalId: "x-1", transactionId: "nope" })).toEqual({
      applied: false,
    });
  });

  it("revokeAll zeroes credits and revokes subscriptions; a later grant works again", async () => {
    const u = newUser();
    await credits(u, 4);
    await subscribe(u, { otid: `admin:${u}` });
    expect(await ent.revokeAll(u, { externalId: `admin:revoke-${u}` })).toEqual({ applied: true });
    const e = await ent.getEntitlement(u);
    expect(e).toMatchObject({ credits: 0, subscription: null, canUsePremium: false });
    await subscribe(u, { otid: `admin:${u}`, days: 7 });
    expect((await ent.getEntitlement(u)).subscription).not.toBeNull();
  });

  it("rejects malformed grants", async () => {
    const u = newUser();
    await expect(ent.grantCredits({ userId: u, credits: 0, source: "admin", externalId: "a" })).rejects.toThrow();
    await expect(ent.grantCredits({ userId: u, credits: 1.5, source: "admin", externalId: "b" })).rejects.toThrow();
    await expect(
      // @ts-expect-error: unknown source on purpose
      ent.grantCredits({ userId: u, credits: 1, source: "paypal", externalId: "c" }),
    ).rejects.toThrow();
    await expect(
      ent.grantSubscription({
        userId: u,
        source: "web",
        externalId: "d",
        originalTransactionId: "t",
        productId: "monthly",
        periodStart: "2026-02-01T00:00:00Z",
        periodEnd: "2026-01-01T00:00:00Z",
        willRenew: false,
      }),
    ).rejects.toThrow();
  });

  it("deleteUserEntitlements leaves no rows of the user", async () => {
    const u = newUser();
    await credits(u, 3);
    await subscribe(u);
    const r = await ent.reservePremiumVerdict(u, { idempotencyKey: "k" });
    if (!r.ok) throw new Error("expected a reservation");
    const today = await ent.countPremiumToday();
    await ent.deleteUserEntitlements(u);
    for (const table of ["entitlement_accounts", "entitlement_grants", "subscriptions", "premium_usage"]) {
      expect(await count(table, u), table).toBe(0);
    }
    // The run still counts towards the site-wide daily cap.
    expect(await ent.countPremiumToday()).toBe(today);
  });
});
