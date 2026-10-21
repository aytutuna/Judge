import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-hold-"));
const file = path.join(dir, "test.db").replace(/\\/g, "/");
process.env.DATABASE_URL = `file:${file}`;

// A database from before hold_until existed: the migration must add it.
const legacy = createClient({ url: `file:${file}` });
await legacy.execute(`CREATE TABLE premium_usage (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, idempotency_key TEXT, funded_by TEXT NOT NULL,
  subscription_id TEXT, sub_period_end TEXT, status TEXT NOT NULL, verdict_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
await legacy.execute(`INSERT INTO premium_usage VALUES ('old', 'u-old', NULL, 'credits', NULL, NULL, 'consumed', 'v', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
legacy.close();

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

let n = 0;
const newUser = () => `hold-${++n}-${Math.random().toString(36).slice(2, 7)}`;
const MIN = 60_000;

async function withCredits(k: number): Promise<string> {
  const u = newUser();
  await ent.grantCredits({ userId: u, credits: k, source: "admin", externalId: `g:${u}` });
  return u;
}

async function reserve(u: string, now: Date) {
  const r = await ent.reservePremiumVerdict(u, { now });
  if (!r.ok) throw new Error(`reserve failed: ${r.code}`);
  return r.reservation.id;
}

async function status(id: string): Promise<string> {
  const db = await getDb();
  return String((await db.execute({ sql: "SELECT status FROM premium_usage WHERE id = ?", args: [id] })).rows[0].status);
}

describe("premium_usage.hold_until", () => {
  it("is added to an existing table without touching old rows", async () => {
    await ent.ensureEntitlementTables();
    const db = await getDb();
    const cols = (await db.execute("PRAGMA table_info(premium_usage)")).rows.map((r) => String(r.name));
    expect(cols).toContain("hold_until");
    expect(await status("old")).toBe("consumed");
  });

  it("the stale sweep leaves a held reservation alone until hold_until + 10 minutes", async () => {
    const u = await withCredits(1);
    const t0 = new Date("2026-10-20T10:00:00.000Z");
    const id = await reserve(u, t0);
    const until = new Date(t0.getTime() + 7 * 24 * 60 * MIN);
    await ent.entitlementWriteBatch([ent.holdStatement(id, until.toISOString())]);
    await ent.sweepStaleReservations(new Date(t0.getTime() + 11 * MIN));
    expect(await status(id)).toBe("reserved");
    await ent.sweepStaleReservations(new Date(until.getTime() + 9 * MIN));
    expect(await status(id)).toBe("reserved");
    await ent.sweepStaleReservations(new Date(until.getTime() + 11 * MIN));
    expect(await status(id)).toBe("refunded");
    expect((await ent.getEntitlement(u, new Date(until.getTime() + 12 * MIN))).credits).toBe(1);
  });

  it("rows without a hold keep the 10-minute rule", async () => {
    const u = await withCredits(1);
    const t0 = new Date("2026-10-21T10:00:00.000Z");
    const id = await reserve(u, t0);
    await ent.sweepStaleReservations(new Date(t0.getTime() + 11 * MIN));
    expect(await status(id)).toBe("refunded");
  });
});

describe("statement builders", () => {
  it("consumeStatement and refundStatements apply only while reserved, and honor a guard", async () => {
    const u = await withCredits(2);
    const now = new Date();
    const a = await reserve(u, now);
    const iso = now.toISOString();
    // A false guard changes nothing.
    await ent.entitlementWriteBatch([ent.consumeStatement(a, "v1", iso, { sql: "1 = 0", args: [] })]);
    expect(await status(a)).toBe("reserved");
    await ent.entitlementWriteBatch([ent.consumeStatement(a, "v1", iso, { sql: "1 = ?", args: [1] })]);
    expect(await status(a)).toBe("consumed");
    // A consumed unit is never refunded.
    await ent.entitlementWriteBatch(ent.refundStatements(a, iso));
    expect(await status(a)).toBe("consumed");
    expect((await ent.getEntitlement(u)).credits).toBe(1);

    const b = await reserve(u, now);
    expect((await ent.getEntitlement(u)).credits).toBe(0);
    await ent.entitlementWriteBatch(ent.refundStatements(b, iso, { sql: "1 = 0", args: [] }));
    expect(await status(b)).toBe("reserved");
    await ent.entitlementWriteBatch(ent.refundStatements(b, iso));
    await ent.entitlementWriteBatch(ent.refundStatements(b, iso));
    expect(await status(b)).toBe("refunded");
    expect((await ent.getEntitlement(u)).credits).toBe(1);
  });

  it("refundStatements returns a subscription unit like refundPremiumVerdict", async () => {
    const u = newUser();
    const start = new Date(Date.now() - 1000);
    await ent.grantSubscription({
      userId: u,
      source: "admin",
      externalId: `sub:${u}`,
      originalTransactionId: `ot:${u}`,
      productId: "monthly",
      periodStart: start.toISOString(),
      periodEnd: new Date(start.getTime() + 30 * 24 * 60 * MIN).toISOString(),
      willRenew: true,
      cap: 2,
    });
    const id = await reserve(u, new Date());
    expect((await ent.getEntitlement(u)).subscription!.used).toBe(1);
    await ent.entitlementWriteBatch(ent.refundStatements(id, new Date().toISOString()));
    expect((await ent.getEntitlement(u)).subscription!.used).toBe(0);
  });

  it("reservationByKey reports a keyed reservation", async () => {
    const u = await withCredits(1);
    const r = await ent.reservePremiumVerdict(u, { idempotencyKey: "appeal:c1:k1" });
    expect(r.ok).toBe(true);
    expect(await ent.reservationByKey(u, "appeal:c1:k1")).toEqual({ status: "reserved", verdictId: null });
    expect(await ent.reservationByKey(u, "nope")).toBeNull();
  });
});
