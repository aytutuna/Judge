import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/** Deleting an account unlinks its ratings and consent records; the ledger stays append-only. */

const dir = mkdtempSync(path.join(tmpdir(), "verdict-unlink-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { removeUserData } = await import("../lib/originals/removal");
const { ensureOriginalsTables } = await import("../lib/originals/db");
const { recordConsent, setRating } = await import("../lib/feedback/db");
const { recordSensitiveAgreement } = await import("../lib/feedback/agreement");
const { getDb } = await import("../lib/db");
const { backdateUnlinked } = await import("./ledger-backdate");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const WORDING = { source: "switch", wordingKey: "consent.switchDetail", wordingText: "text", lang: "en", platform: "web" } as const;

async function all(sql: string, args: string[] = []) {
  const db = await getDb();
  return (await db.execute({ sql, args })).rows.map((r) => ({ ...r }));
}

async function member(id: string) {
  await ensureOriginalsTables();
  await recordConsent(id, { choice: "on", ...WORDING });
  await recordConsent(id, { choice: "off", ...WORDING });
  await recordConsent(id, { choice: "on", ...WORDING });
  await recordSensitiveAgreement(id, "en", "web");
  await setRating("verdict-1", id, "up");
  await setRating("verdict-2", id, "down");
}

describe("account deletion and the feedback records", () => {
  it("unlinks ratings and ledger rows, drops the current choice, and touches nobody else", async () => {
    await member("u-gone");
    await member("u-stays");
    const before = await all("SELECT * FROM consent_ledger WHERE user_id = 'u-gone' ORDER BY id");
    expect(before).toHaveLength(4);

    const at = new Date("2026-12-01T10:00:00.000Z");
    await removeUserData("u-gone", at, { log: false });

    expect(await all("SELECT 1 FROM consent_ledger WHERE user_id = 'u-gone'")).toHaveLength(0);
    expect(await all("SELECT 1 FROM consent_state WHERE user_id = 'u-gone'")).toHaveLength(0);
    expect(await all("SELECT 1 FROM verdict_ratings WHERE user_id = 'u-gone'")).toHaveLength(0);

    const after = await all("SELECT * FROM consent_ledger WHERE id IN (" + before.map((r) => r.id).join(",") + ") ORDER BY id");
    const ids = new Set(after.map((r) => r.user_id));
    expect(ids.size).toBe(1);
    expect(String([...ids][0])).toMatch(/^deleted:[0-9a-f]{16}$/);
    for (const [i, row] of after.entries()) {
      expect(Date.now() - Date.parse(String(row.unlinked_at))).toBeLessThan(60_000);
      expect({ ...row, user_id: "x", unlinked_at: null }).toEqual({ ...before[i], user_id: "x", unlinked_at: null });
    }

    const ratings = await all("SELECT verdict_id, user_id, rating FROM verdict_ratings WHERE user_id LIKE 'deleted:%' ORDER BY verdict_id");
    expect(ratings.map((r) => [r.verdict_id, r.rating])).toEqual([["verdict-1", "up"], ["verdict-2", "down"]]);
    expect(new Set(ratings.map((r) => r.user_id)).size).toBe(2);

    expect(await all("SELECT 1 FROM consent_ledger WHERE user_id = 'u-stays'")).toHaveLength(4);
    expect(await all("SELECT 1 FROM consent_state WHERE user_id = 'u-stays'")).toHaveLength(1);
    expect(await all("SELECT 1 FROM verdict_ratings WHERE user_id = 'u-stays'")).toHaveLength(2);
  });

  it("unlinks on a replay that carries an old removal time", async () => {
    await member("u-replay");
    await removeUserData("u-replay", new Date("2020-01-01T00:00:00.000Z"), { log: false });
    expect(await all("SELECT 1 FROM consent_ledger WHERE user_id = 'u-replay'")).toHaveLength(0);
    expect(await all("SELECT 1 FROM consent_state WHERE user_id = 'u-replay'")).toHaveLength(0);
  });

  it("is harmless to run again, as a replay after a restore does", async () => {
    await member("u-twice");
    await removeUserData("u-twice", new Date("2026-12-02T00:00:00.000Z"), { log: false });
    const first = await all("SELECT user_id, unlinked_at FROM consent_ledger WHERE user_id LIKE 'deleted:%' ORDER BY id");
    await removeUserData("u-twice", new Date("2026-12-03T00:00:00.000Z"), { log: false });
    expect(await all("SELECT user_id, unlinked_at FROM consent_ledger WHERE user_id LIKE 'deleted:%' ORDER BY id")).toEqual(first);
  });
});

describe("the consent ledger stays append-only", () => {
  async function refuses(sql: string, args: string[] = []) {
    const db = await getDb();
    await expect(db.execute({ sql, args })).rejects.toThrow(/append-only/);
  }

  it("refuses an ordinary update or delete of a linked row", async () => {
    await member("u-guard");
    await refuses("UPDATE consent_ledger SET choice = 'off' WHERE user_id = 'u-guard'");
    await refuses("UPDATE consent_ledger SET wording_text = 'other' WHERE user_id = 'u-guard'");
    await refuses("UPDATE consent_ledger SET user_id = 'u-other' WHERE user_id = 'u-guard'");
    await refuses("UPDATE consent_ledger SET user_id = 'deleted:abc' WHERE user_id = 'u-guard'");
    await refuses("UPDATE consent_ledger SET unlinked_at = '2020-01-01T00:00:00.000Z' WHERE user_id = 'u-guard'");
    await refuses("UPDATE consent_ledger SET user_id = 'deleted:abc', unlinked_at = '2000-01-01T00:00:00.000Z' WHERE user_id = 'u-guard'");
    await refuses("DELETE FROM consent_ledger WHERE user_id = 'u-guard'");
    expect(await all("SELECT 1 FROM consent_ledger WHERE user_id = 'u-guard'")).toHaveLength(4);
  });

  it("allows only the move to a placeholder, once, and the delete six years after it", async () => {
    await member("u-old");
    await member("u-young");
    await removeUserData("u-old", new Date(), { log: false });
    await backdateUnlinked("2019-03-01T00:00:00.000Z");
    await removeUserData("u-young", new Date(), { log: false });

    const [old] = await all("SELECT user_id FROM consent_ledger WHERE unlinked_at = '2019-03-01T00:00:00.000Z' LIMIT 1");
    await refuses("UPDATE consent_ledger SET user_id = 'deleted:other' WHERE user_id = ?", [String(old.user_id)]);
    await refuses("UPDATE consent_ledger SET user_id = 'u-old' WHERE user_id = ?", [String(old.user_id)]);
    await refuses("UPDATE consent_ledger SET choice = 'off' WHERE user_id = ?", [String(old.user_id)]);

    const [young] = await all("SELECT user_id FROM consent_ledger WHERE unlinked_at > '2026' LIMIT 1");
    await refuses("DELETE FROM consent_ledger WHERE user_id = ?", [String(young.user_id)]);

    const db = await getDb();
    const gone = await db.execute({ sql: "DELETE FROM consent_ledger WHERE user_id = ?", args: [String(old.user_id)] });
    expect(gone.rowsAffected).toBe(4);
  });
});
