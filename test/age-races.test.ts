import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The guards on the age writes, one interleaving at a time: the account row
 * is changed between a function's read and its write batch, so each guard
 * is the only thing standing between the write and a wrong result.
 */

const dir = mkdtempSync(path.join(tmpdir(), "verdict-races-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3600";

const { createDevSession } = await import("../lib/auth");
const { getDb } = await import("../lib/db");
const ent = await import("../lib/entitlements");
const { blockMinor, recordMinorSignal, submitDob } = await import("../lib/age");
const { insertEvents, analyticsDb } = await import("../lib/analytics/db");
const { ensureOriginalsTables } = await import("../lib/originals/db");
const { getConsent, recordConsent } = await import("../lib/feedback/db");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function ago(years: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear() - years, n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10);
}

async function setRow(userId: string, sets: string, args: (string | null)[] = []) {
  await (await getDb()).execute({ sql: `UPDATE "user" SET ${sets} WHERE id = ?`, args: [...args, userId] });
}

async function row(userId: string) {
  const rs = await (await getDb()).execute({ sql: 'SELECT * FROM "user" WHERE id = ?', args: [userId] });
  return rs.rows[0];
}

/** Runs `change` after the next write batch was built and before it runs. */
function interleave(change: () => Promise<void>): void {
  const real = ent.entitlementWriteBatch;
  vi.spyOn(ent, "entitlementWriteBatch").mockImplementationOnce(async (stmts) => {
    await change();
    return real(stmts);
  });
}

/** An account with a training consent that is on and one stored usage event. */
async function account(email: string) {
  const { user } = await createDevSession(email);
  await ensureOriginalsTables();
  await recordConsent(user.id, {
    choice: "on",
    source: "switch",
    wordingKey: "consent.switchDetail",
    wordingText: "x",
    lang: "en",
    platform: "web",
  });
  await insertEvents([
    { at: Date.now(), userId: user.id, anonId: null, deviceId: null, platform: "web", appVersion: null, osVersion: null, deviceModel: null, country: null, locale: null, name: "app_open", props: null },
  ]);
  return user.id;
}

const events = async (userId: string) =>
  (await (await analyticsDb()).execute({ sql: "SELECT id FROM events WHERE user_id = ? AND name = 'app_open'", args: [userId] })).rows.length;
const consentOn = async (userId: string) => (await getConsent(userId)).state === "on";

describe("blockMinor", () => {
  it("does not close an account whose date landed first, nor delete its events", async () => {
    const id = await account("race-block@verdict.local");
    interleave(() => setRow(id, "age_dob_at = ?, age_confirmed_at = ?", ["2026-11-26T00:00:00.000Z", "2026-11-26T00:00:00.000Z"]));
    expect(await blockMinor(id)).toBeNull();
    expect(vi.mocked(console.warn).mock.calls.some((c) => String(c[0]).startsWith("[signal:age_blocked]"))).toBe(false);
    expect((await row(id)).age_blocked_at).toBeNull();
    expect(await events(id)).toBe(1);
  });
});

describe("recordMinorSignal", () => {
  for (const [name, change] of [
    ["a block", (id: string) => setRow(id, "age_blocked_at = ?, age_block_final = '1'", ["2026-11-26T00:00:00.000Z"])],
  ] as const) {
    it(`writes nothing, and leaves consent and events, when ${name} landed first`, async () => {
      const id = await account(`race-signal-${name.split(" ")[1]}@verdict.local`);
      interleave(() => change(id));
      await recordMinorSignal(id, undefined);
      expect((await row(id)).age_signal).toBeNull();
      expect(await consentOn(id)).toBe(true);
      expect(await events(id)).toBe(1);
    });
  }
});

describe("recordMinorSignal after a date", () => {
  it("still records the signal when an adult date landed first", async () => {
    const id = await account("race-signal-adult-date@verdict.local");
    interleave(() => setRow(id, "age_dob_at = ?", ["2026-11-26T00:00:00.000Z"]));
    await recordMinorSignal(id, undefined);
    expect((await row(id)).age_signal).toBe("minor");
    expect(await consentOn(id)).toBe(false);
    expect(await events(id)).toBe(0);
  });
});

describe("recordMinorSignal on a teen", () => {
  it("does not overwrite an adult signal that landed after the read, and records the minor one instead", async () => {
    const id = await account("race-teen-adult-signal@verdict.local");
    await setRow(id, "age_dob = ?, age_dob_at = ?, age_confirmed_at = ?", [ago(15), "2026-11-20T00:00:00.000Z", "2026-11-20T00:00:00.000Z"]);
    interleave(() => setRow(id, "age_signal = 'adult'"));
    await recordMinorSignal(id, undefined);
    // The fast path wrote nothing, so the full write ran: consent and events went with it.
    expect((await row(id)).age_signal).toBe("minor");
    expect(await consentOn(id)).toBe(false);
    expect(await events(id)).toBe(0);
  });
});

describe("submitDob", () => {
  it("a date that lost to the same teen date written at another time runs no teen statements", async () => {
    const id = await account("race-same-dob@verdict.local");
    const dob = ago(15);
    interleave(() => setRow(id, "age_dob = ?, age_dob_at = ?, age_source = 'dob'", [dob, "2020-01-01T00:00:00.000Z"]));
    expect(await submitDob(id, dob)).toBeNull();
    expect(await consentOn(id)).toBe(true);
    expect(await events(id)).toBe(1);
  });

  it("a teen date that lost to an adult date written in the same millisecond runs no teen statements", async () => {
    const id = await account("race-same-ms@verdict.local");
    const now = new Date();
    interleave(() => setRow(id, "age_dob = NULL, age_dob_at = ?, age_source = 'dob'", [now.toISOString()]));
    expect(await submitDob(id, ago(15), now)).toBeNull();
    expect(await consentOn(id)).toBe(true);
    expect(await events(id)).toBe(1);
  });

  it("an under-13 date that lost to a date answers null, so the route says 409, and signals nothing", async () => {
    const id = await account("race-child-lost@verdict.local");
    interleave(() => setRow(id, "age_dob_at = ?, age_confirmed_at = ?", ["2026-11-26T00:00:00.000Z", "2026-11-26T00:00:00.000Z"]));
    expect(await submitDob(id, ago(10))).toBeNull();
    expect((await row(id)).age_blocked_at).toBeNull();
    expect(vi.mocked(console.warn).mock.calls.some((c) => String(c[0]).startsWith("[signal:age_blocked]"))).toBe(false);
  });

  it("reports a final block as it is, not as a second date", async () => {
    const { user } = await createDevSession("race-final-state@verdict.local");
    await blockMinor(user.id);
    expect((await submitDob(user.id, ago(15)))?.blocked).toBe(true);
  });

  describe("the kept block on the email", () => {
    const claimBlocked = async (claim: string) =>
      (await (await getDb()).execute({ sql: "SELECT age_blocked_at FROM welcome_claims WHERE claim = ?", args: [claim] })).rows[0]?.age_blocked_at;
    const addClaim = async (claim: string, final: string | null) => {
      await ent.ensureEntitlementTables();
      await (await getDb()).execute({
        sql: "INSERT OR REPLACE INTO welcome_claims (claim, created_at, age_blocked_at, age_block_final) VALUES (?, ?, ?, ?)",
        args: [claim, "2026-11-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z", final],
      });
    };
    const oldBlock = async (email: string) => {
      const { user } = await createDevSession(email);
      await setRow(user.id, "age_blocked_at = ?, age_block_final = NULL", ["2026-11-01T00:00:00.000Z"]);
      return user.id;
    };

    it("is lifted with the account's block", async () => {
      const id = await oldBlock("race-claim-lift@verdict.local");
      await addClaim("claim-lift", null);
      expect((await submitDob(id, ago(15), new Date(), ["claim-lift"]))?.blocked).toBe(false);
      expect(await claimBlocked("claim-lift")).toBeNull();
    });

    it("stays when this date lost the race", async () => {
      const id = await oldBlock("race-claim-lost@verdict.local");
      await addClaim("claim-lost", null);
      interleave(() => setRow(id, "age_blocked_at = NULL, age_dob_at = ?, age_source = 'dob'", ["2020-01-01T00:00:00.000Z"]));
      expect(await submitDob(id, ago(30), new Date(), ["claim-lost"])).toBeNull();
      expect(await claimBlocked("claim-lost")).toEqual(expect.any(String));
    });

    it("stays when it is final", async () => {
      const id = await oldBlock("race-claim-final@verdict.local");
      await addClaim("claim-final", "1");
      expect((await submitDob(id, ago(30), new Date(), ["claim-final"]))?.blocked).toBe(false);
      expect(await claimBlocked("claim-final")).toEqual(expect.any(String));
    });
  });
});
