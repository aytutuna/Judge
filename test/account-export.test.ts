import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/** GET /api/v1/me/export: the signed-in person's copy of their data, and nobody else's. */

const dir = mkdtempSync(path.join(tmpdir(), "verdict-export-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
process.env.BETTER_AUTH_URL = "http://localhost:3600";

const { createDevSession } = await import("../lib/auth");
const ent = await import("../lib/entitlements");
const { getDb } = await import("../lib/db");
const { saveVerdictWithOriginals, sealOriginal, sealCaseDisplay } = await import("../lib/originals/save");
const { ensureOriginalsTables } = await import("../lib/originals/db");
const { recordConsent, setRating } = await import("../lib/feedback/db");
const { recordSensitiveAgreement } = await import("../lib/feedback/agreement");
const { insertEvents } = await import("../lib/analytics/db");
const exportRoute = await import("../app/api/v1/me/export/route");
const meRoute = await import("../app/api/v1/me/route");
import type { VerdictResult } from "../lib/types";

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

const RESULT = {
  verdict: "side_b",
  dispute_type: "values",
  headline: "A headline",
  crux: "The crux",
  split_points: null,
  conditional: null,
  argument_map: { side_a: [], side_b: [], bedrock_a: "a", bedrock_b: "b" },
  facts_relied_on: [],
  losing_side_best_point: "p",
  confidence: 4,
  runs: ["side_b"],
  demo: false,
  lang: "en",
} as unknown as VerdictResult;

const NOW = "2026-11-10T00:00:00.000Z";
const exportOf = (token: string) =>
  exportRoute.GET(new Request("http://localhost:3600/api/v1/me/export", { headers: { authorization: `Bearer ${token}` } }));

async function all(sql: string, args: (string | number)[] = []) {
  const db = await getDb();
  return (await db.execute({ sql, args })).rows.map((r) => ({ ...r }));
}

/** A two-sided case between `a` and `b`, each side with its own sealed original and display name. */
async function twoSidedCase(id: string, a: string, b: string) {
  await ensureOriginalsTables();
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO cases (id, owner_id, status, mode, framework, lang, invite_nonce, invite_hash, respondent_user_id,
            sides, expires_at, created_at, updated_at, display_a_sealed, display_b_sealed)
          VALUES (?, ?, 'judged', 'two_sided', '{}', 'en', 'n', ?, ?, 2, ?, ?, ?, ?, ?)`,
    args: [
      id, a, `h-${id}`, b, NOW, NOW, NOW,
      sealCaseDisplay(id, "a", "Alice Display")!.sealed,
      sealCaseDisplay(id, "b", "Bob Display")!.sealed,
    ],
  });
  for (const [party, word, name] of [["a", "ALICE-SIDE-TEXT", "Alice Real"], ["b", "BOB-SIDE-TEXT", "Bob Real"]] as const) {
    await db.execute({ sql: "INSERT INTO case_sides (case_id, party, text, submitted_at) VALUES (?, ?, ?, ?)", args: [id, party, `anon ${word}`, NOW] });
    const subject = `case:${id}:side:${party}`;
    await db.execute({
      sql: `INSERT INTO originals (subject, kind, case_id, party, sealed, key_id, created_at, updated_at)
            VALUES (?, 'side', ?, ?, ?, 'k', ?, ?)`,
      args: [subject, id, party, sealOriginal(subject, { v: 1, text: `raw ${word}`, nameMap: [{ original: name, replacement: "Person C" }] })!.sealed, NOW, NOW],
    });
  }
  await db.execute({ sql: "INSERT INTO verdicts (id, input, framework, result) VALUES (?, 'x', '{}', ?)", args: [`${id}-v`, JSON.stringify(RESULT)] });
  await db.execute({ sql: "INSERT INTO case_verdicts (case_id, seq, verdict_id, mode, created_at) VALUES (?, 1, ?, 'two_sided', ?)", args: [id, `${id}-v`, NOW] });
}

describe("GET /api/v1/me/export", () => {
  it("401 signed out, and a dead token is refused", async () => {
    const res = await exportRoute.GET(new Request("http://localhost:3600/api/v1/me/export"));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("signin_required");
    const dead = await exportOf("not-a-token");
    expect(dead.status).toBe(401);
  });

  it("downloads everything the person holds, with their own originals decrypted", async () => {
    const { token, user } = await createDevSession("ex1@verdict.local");
    const other = await createDevSession("ex1-other@verdict.local");
    const db = await getDb();
    await ent.grantCredits({ userId: user.id, credits: 4, source: "admin", externalId: "admin:ex1" });

    await saveVerdictWithOriginals({
      id: "ex1-verdict",
      input: "anonymized words",
      result: RESULT,
      kind: "premium",
      ownerUserId: user.id,
      original: { v: 1, text: "RAW-OWN-TEXT with Dana Smith", nameMap: [{ original: "Dana Smith", replacement: "Person C" }] },
    });
    await saveVerdictWithOriginals({
      id: "ex1-someone-elses",
      input: "x",
      result: RESULT,
      kind: "premium",
      ownerUserId: other.user.id,
      original: { v: 1, text: "RAW-OTHER-ACCOUNT-TEXT", nameMap: [] },
    });
    await twoSidedCase("ex1-case-aaaa", user.id, other.user.id);
    await recordConsent(user.id, { choice: "on", source: "card", wordingKey: "consent.cardBody", wordingText: "w", lang: "en", platform: "ios" });
    await recordSensitiveAgreement(user.id, "en", "ios");
    await setRating("ex1-verdict", user.id, "up");
    await db.execute({
      sql: "INSERT INTO account_devices (user_id, device_id, platform, country, first_seen, last_seen) VALUES (?, 'dev-1', 'ios', 'CA', 1700000000000, 1700000100000)",
      args: [user.id],
    });
    await insertEvents([
      { at: 1700000000000, userId: user.id, anonId: null, deviceId: "dev-1", platform: "ios", appVersion: "1.0", osVersion: "26", deviceModel: "iPhone", country: "CA", locale: "en", name: "verdict_made", props: '{"n":1}' },
      { at: 1700000000001, userId: other.user.id, anonId: null, deviceId: "dev-2", platform: "web", appVersion: null, osVersion: null, deviceModel: null, country: null, locale: null, name: "someone_else", props: null },
    ]);

    const res = await exportOf(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="judge-data-\d{4}-\d\d-\d\d\.json"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const raw = await res.text();
    const data = JSON.parse(raw);

    expect(data.account).toMatchObject({ id: user.id, email: "ex1@verdict.local", hasPassword: false });
    expect(data.verdicts.map((v: { id: string }) => v.id)).toEqual(["ex1-verdict"]);
    expect(data.verdicts[0].original).toMatchObject({ status: "stored", original: { text: "RAW-OWN-TEXT with Dana Smith" } });
    expect(data.verdicts[0].original.original.nameMap).toEqual([{ original: "Dana Smith", replacement: "Person C" }]);
    expect(data.verdicts[0].anonymizedText).toBe("anonymized words");
    expect(data.verdicts[0].result.headline).toBe("A headline");

    expect(data.cases).toHaveLength(1);
    expect(data.cases[0]).toMatchObject({ id: "ex1-case-aaaa", yourParty: "a", yourDisplayName: "Alice Display" });
    expect(data.cases[0].yourOriginal.side.original.text).toBe("raw ALICE-SIDE-TEXT");
    expect(data.cases[0].yourAnonymizedText.text).toBe("anon ALICE-SIDE-TEXT");
    expect(data.cases[0].verdicts[0].result.headline).toBe("A headline");

    expect(data.ratings).toMatchObject([{ verdictId: "ex1-verdict", rating: "up" }]);
    expect(data.consent.helpImproveJudge).toMatchObject({ choice: "on" });
    expect(data.consent.history.map((h: { kind: string }) => h.kind)).toEqual(["training", "sensitive"]);
    expect(data.usage.devices).toEqual([
      { deviceId: "dev-1", platform: "ios", country: "CA", firstSeen: "2023-11-14T22:13:20.000Z", lastSeen: "2023-11-14T22:15:00.000Z" },
    ]);
    expect(data.usage.events).toContainEqual(expect.objectContaining({ name: "verdict_made", props: { n: 1 } }));
    expect(data.purchases.credits).toBe(5);
    expect(data.purchases.grants.map((g: { kind: string }) => g.kind)).toContain("credits");

    // Nothing of the other party or the other account.
    for (const secret of ["BOB-SIDE-TEXT", "Bob Display", "Bob Real", "RAW-OTHER-ACCOUNT-TEXT", "someone_else", "ex1-other@verdict.local"]) {
      expect(raw, secret).not.toContain(secret);
    }
    // No credentials.
    expect(raw).not.toMatch(/accessToken|refreshToken|idToken|"password"/);
  });

  it("gives the other party of a case their own side only", async () => {
    const { token, user } = await createDevSession("ex2@verdict.local");
    await twoSidedCase("ex2-case-aaaa", "someone-owner", user.id);
    const raw = await (await exportOf(token)).text();
    const data = JSON.parse(raw);
    expect(data.cases[0]).toMatchObject({ yourParty: "b", yourDisplayName: "Bob Display" });
    expect(data.cases[0].yourOriginal.side.original.text).toBe("raw BOB-SIDE-TEXT");
    expect(raw).not.toContain("ALICE-SIDE-TEXT");
    expect(raw).not.toContain("Alice Display");
  });

  it("still works for an account the age check blocked, and is rate limited", async () => {
    const { token, user } = await createDevSession("ex3@verdict.local");
    const db = await getDb();
    await db.execute({ sql: 'UPDATE "user" SET age_blocked_at = ? WHERE id = ?', args: [NOW, user.id] });
    expect((await exportOf(token)).status).toBe(200);
    expect((await exportOf(token)).status).toBe(200);
    expect((await exportOf(token)).status).toBe(200);
    const limited = await exportOf(token);
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { code: string }).code).toBe("rate_limited");
  });
});

describe("deleting the account", () => {
  it("leaves no rating, choice or ledger row that leads back to the person", async () => {
    const { token, user } = await createDevSession("ex4@verdict.local");
    await ensureOriginalsTables();
    await recordConsent(user.id, { choice: "on", source: "card", wordingKey: "consent.cardBody", wordingText: "w", lang: "en", platform: "web" });
    await recordSensitiveAgreement(user.id, "en", "web");
    await setRating("ex4-verdict", user.id, "down");
    const res = await meRoute.DELETE(
      new Request("http://localhost:3600/api/v1/me", {
        method: "DELETE",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirm: "delete" }),
      }),
    );
    expect(res.status).toBe(200);
    for (const table of ["consent_ledger", "consent_state", "verdict_ratings"]) {
      expect(await all(`SELECT 1 FROM ${table} WHERE user_id = ?`, [user.id]), table).toHaveLength(0);
    }
    expect(await all("SELECT rating FROM verdict_ratings WHERE verdict_id = 'ex4-verdict'")).toEqual([{ rating: "down" }]);
    expect(await all("SELECT 1 FROM consent_ledger WHERE user_id LIKE 'deleted:%' AND unlinked_at IS NOT NULL")).toHaveLength(2);
  });
});
