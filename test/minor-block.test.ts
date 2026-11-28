import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * A final under-13 block: the account's share pages close at once, and 7 days
 * later the daily cleanup deletes its data, against a real (temporary)
 * database. The auth tables belong to Better Auth, which is not loaded here.
 */

const dir = mkdtempSync(path.join(tmpdir(), "verdict-minor-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

vi.mock("../lib/auth", async () => {
  const { getDb } = await import("../lib/db");
  return {
    welcomeClaim: (email: string) => `claim:${email}`,
    deleteAuthUser: async (id: string) => {
      await (await getDb()).execute({ sql: 'DELETE FROM "user" WHERE id = ?', args: [id] });
    },
  };
});

const { getDb } = await import("../lib/db");
await (await getDb()).execute(
  'CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, email TEXT, age_confirmed_at TEXT, age_blocked_at TEXT, age_block_final TEXT, age_block_final_at TEXT, age_dob TEXT, age_dob_at TEXT, age_signal TEXT, age_signal_at TEXT)',
);
const { blockMinor, keptBlock, caseHasTeen } = await import("../lib/age");
const { runCleanup } = await import("../lib/cleanup");
const { saveVerdictWithOriginals } = await import("../lib/originals/save");
const { getPublicVerdict } = await import("../lib/originals/display");
const { verdictRemoved } = await import("../lib/originals/removed");
const { recordConsent, setRating } = await import("../lib/feedback/db");
const { ensureOriginalsTables } = await import("../lib/originals/db");
const { BLOCK_GRACE_MS } = await import("../lib/minor-deletion");
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

const RESULT: VerdictResult = {
  verdict: "side_b",
  dispute_type: "values",
  headline: "Party B is right",
  why: "Because of the receipt",
  crux: "Whether Party A owes Party B",
  split_points: [{ party: "a", point: "A paid for dinner" }],
  conditional: null,
  argument_map: { side_a: [{ claim: "I paid", kind: "fact" }], side_b: [{ claim: "He owes me", kind: "value" }], bedrock_a: "fairness", bedrock_b: "promises" },
  facts_relied_on: ["The receipt shows 40 pounds"],
  losing_side_best_point: "Dinner counts",
  confidence: 4,
  runs: ["side_b", "side_b", "split"],
  demo: false,
  lang: "en",
  tier: "premium",
  lean: { party: "b", unanimous: false, reason: "closer", tally: { for: 2, against: 1 } },
  fact_check: { status: "checked", claims: [{ claim: "paid 40", status: "supported", summary: "yes", sources: [{ title: "Receipt", url: "https://x.test" }] }] },
  panel: { models: ["strong", "strong", "quick"] },
  evidence_used: { a: 1, b: 0 },
  crux_trial: { attack: "What about tax", outcome: "survived", reasoning: "irrelevant" },
};

const DAY = 24 * 60 * 60_000;
const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

async function all(sql: string, args: (string | number)[] = []) {
  return (await (await getDb()).execute({ sql, args })).rows.map((r) => ({ ...r }));
}
const one = async (sql: string, args: (string | number)[] = []) => (await all(sql, args))[0];

async function user(id: string, blockedDaysAgo: number | null, final = true) {
  await (await getDb()).execute({
    sql: 'INSERT INTO "user" (id, email, age_blocked_at, age_block_final, age_block_final_at) VALUES (?, ?, ?, ?, ?)',
    args: [
      id,
      `${id}@example.test`,
      blockedDaysAgo === null ? null : ago(blockedDaysAgo),
      blockedDaysAgo !== null && final ? "1" : null,
      blockedDaysAgo !== null && final ? ago(blockedDaysAgo) : null,
    ],
  });
}

async function verdict(id: string, owner: string) {
  await saveVerdictWithOriginals({
    id,
    input: `${id} says Party A owes him`,
    result: RESULT,
    kind: "premium",
    ownerUserId: owner,
    original: { v: 1, text: "raw", nameMap: [] },
  });
  return id;
}

/** A judged case: owner a, respondent b, and an invited third side c when given. */
async function makeCase(id: string, a: string, b: string | null, c: string | null = null) {
  const d = await getDb();
  const at = ago(20);
  const parties = ["a", ...(b ? ["b"] : []), ...(c ? ["c"] : [])];
  await d.execute({
    sql: `INSERT INTO cases (id, owner_id, status, mode, framework, lang, invite_nonce, invite_hash, respondent_user_id, sides, expires_at, created_at, updated_at)
          VALUES (?, ?, 'judged', ?, '{}', 'en', 'n', ?, ?, ?, ?, ?, ?)`,
    args: [id, a, b ? "two_sided" : "one_sided", `h-${id}`, b, Math.max(2, parties.length), at, at, at],
  });
  for (const p of parties) {
    await d.execute({ sql: "INSERT INTO case_sides (case_id, party, text, submitted_at) VALUES (?, ?, ?, ?)", args: [id, p, `${id} side ${p}`, at] });
    await d.execute({
      sql: "INSERT INTO case_evidence (id, case_id, party, seq, kind, transcript, created_at) VALUES (?, ?, ?, 1, 'chat', ?, ?)",
      args: [`${id}-${p}`, id, p, `${id} proof ${p}`, at],
    });
  }
  if (c) {
    await d.execute({
      sql: "INSERT INTO case_invites (case_id, party, invite_nonce, invite_hash, user_id, created_at, updated_at) VALUES (?, 'c', 'n', ?, ?, ?, ?)",
      args: [id, `h-${id}-c`, c, at, at],
    });
  }
  await d.execute({
    sql: `INSERT INTO case_appeals (id, case_id, party, text, status, reservation_id, attempt_token, base_seq, created_at, updated_at)
          VALUES (?, ?, 'a', ?, 'judged', 'r', 't', 1, ?, ?)`,
    args: [`${id}-ap`, id, `${id} appeal a`, at, at],
  });
  const vid = `${id}-v`;
  await d.execute({ sql: "INSERT INTO verdicts (id, input, framework, result) VALUES (?, ?, '{}', ?)", args: [vid, `${id} both sides read`, JSON.stringify(RESULT)] });
  await d.execute({
    sql: "INSERT INTO verdict_meta (verdict_id, kind, case_id, names_visible, created_at, updated_at) VALUES (?, 'case', ?, 1, ?, ?)",
    args: [vid, id, at, at],
  });
  await d.execute({
    sql: "INSERT INTO case_verdicts (case_id, seq, verdict_id, mode, created_at) VALUES (?, 1, ?, ?, ?)",
    args: [id, vid, b ? "two_sided" : "one_sided", at],
  });
  return vid;
}

await ensureOriginalsTables();
// kid: a final block 8 days old. young: a final block 3 days old. old: a block of the former 18+ rule.
await user("kid", 8);
await user("young", 3);
await user("old", 30, false);
await user("adult", null);
await user("pal", null);
const kidVerdict = await verdict("kid-v1", "kid");
const youngVerdict = await verdict("young-v1", "young");
const oldVerdict = await verdict("old-v1", "old");
const adultVerdict = await verdict("adult-v1", "adult");
const caseKidOwns = await makeCase("case-kid-a", "kid", "pal");
const caseKidAnswers = await makeCase("case-kid-b", "adult", "kid");
const caseKidAlone = await makeCase("case-kid-solo", "kid", null);
const caseKidThird = await makeCase("case-kid-c", "adult", "pal", "kid");
const caseOthers = await makeCase("case-others", "adult", "pal");

describe("share pages of a final block", () => {
  it("close at once for the account's verdicts and the cases it wrote or is a side of", async () => {
    for (const id of [kidVerdict, youngVerdict, caseKidOwns, caseKidAnswers, caseKidAlone, caseKidThird]) {
      expect((await getPublicVerdict(id))?.removed, id).toBe(true);
      expect(await verdictRemoved(id), id).toBe(true);
    }
  });

  it("stay open for everyone else, and for a block of the former rule", async () => {
    for (const id of [oldVerdict, adultVerdict, caseOthers]) {
      expect((await getPublicVerdict(id))?.removed, id).toBe(false);
      expect(await verdictRemoved(id), id).toBe(false);
    }
  });

  it("stay open when the blocked account only holds a seat it never answered", async () => {
    await user("seat", 3);
    const vid = await makeCase("case-seat", "adult", "pal");
    await (await getDb()).execute({
      sql: "INSERT INTO case_seats (case_id, party, nonce, user_id, opened_at) VALUES ('case-seat', 'c', 'n', 'seat', ?)",
      args: [ago(1)],
    });
    expect((await getPublicVerdict(vid))?.removed).toBe(false);
  });
});

describe("the final block is timed from when it became final", () => {
  it("sets age_block_final_at when an old block turns final, and never moves it", async () => {
    await user("flip", 40, false);
    expect(await blockMinor("flip", NOW)).toMatchObject({ blocked: true });
    expect(await one('SELECT age_blocked_at, age_block_final, age_block_final_at FROM "user" WHERE id = ?', ["flip"])).toEqual({
      age_blocked_at: ago(40),
      age_block_final: "1",
      age_block_final_at: NOW.toISOString(),
    });
    await blockMinor("flip", new Date(NOW.getTime() + DAY));
    expect((await one('SELECT age_block_final_at FROM "user" WHERE id = ?', ["flip"])).age_block_final_at).toBe(NOW.toISOString());
    await (await getDb()).execute({ sql: 'DELETE FROM "user" WHERE id = ?', args: ["flip"] });
  });
});

describe("a case holding a blocked account", () => {
  it("counts as a case with someone under 18, whichever rule blocked it", async () => {
    expect(await caseHasTeen("case-kid-c")).toBe(true);
    expect(await caseHasTeen("case-kid-a")).toBe(true);
    await user("oldseat", 30, false);
    await makeCase("case-oldseat", "adult", "oldseat");
    expect(await caseHasTeen("case-oldseat")).toBe(true);
    expect(await caseHasTeen("case-others")).toBe(false);
  });
});

describe("the deletion after 7 days", () => {
  it("is 7 days", () => {
    expect(BLOCK_GRACE_MS).toBe(7 * DAY);
  });

  it("takes only the account 7 days past its block, and wipes what it wrote", async () => {
    await recordConsent("kid", { choice: "on", source: "card", wordingKey: "consent.cardBody", wordingText: "w", lang: "en", platform: "web" });
    await setRating(adultVerdict, "kid", "up");
    const rows = () =>
      one("SELECT (SELECT count(*) FROM verdicts) AS v, (SELECT count(*) FROM verdict_meta) AS m, (SELECT count(*) FROM case_sides) AS s");
    const before = await rows();

    expect((await runCleanup(NOW)).blocked).toBe(1);

    expect(await one('SELECT id FROM "user" WHERE id = ?', ["kid"])).toBeUndefined();
    expect(Number((await one('SELECT count(*) AS n FROM "user"')).n)).toBe(6);
    // The block survives, scrambled and final.
    expect(await keptBlock("claim:kid@example.test")).toEqual({ at: expect.any(String), final: true });
    // Its own text is gone, the rows stay.
    expect(await rows()).toEqual(before);
    expect(await one("SELECT input, erased_at FROM verdicts WHERE id = ?", [kidVerdict])).toMatchObject({ input: "", erased_at: NOW.toISOString() });
    expect((await one("SELECT removed_at FROM verdict_meta WHERE verdict_id = ?", [kidVerdict])).removed_at).not.toBeNull();
    expect(await one("SELECT sealed FROM originals WHERE verdict_id = ?", [kidVerdict])).toEqual({ sealed: null });
    expect(await one("SELECT input FROM verdicts WHERE id = ?", [`case-kid-solo-v`])).toEqual({ input: "" });
    const side = (id: string, p: string) => one("SELECT text FROM case_sides WHERE case_id = ? AND party = ?", [id, p]);
    const proof = (id: string, p: string) => one("SELECT transcript FROM case_evidence WHERE case_id = ? AND party = ?", [id, p]);
    for (const [id, p] of [["case-kid-a", "a"], ["case-kid-b", "b"], ["case-kid-solo", "a"], ["case-kid-c", "c"]]) {
      expect(await side(id, p), `${id} ${p}`).toEqual({ text: "" });
      expect(await proof(id, p), `${id} ${p}`).toEqual({ transcript: "" });
    }
    expect(await one("SELECT text FROM case_appeals WHERE case_id = 'case-kid-a'")).toEqual({ text: "" });
    // Other people's sides, and the case verdicts they share, are theirs.
    for (const [id, p] of [["case-kid-a", "b"], ["case-kid-b", "a"], ["case-kid-c", "a"], ["case-kid-c", "b"], ["case-others", "a"]]) {
      expect(await side(id, p), `${id} ${p}`).toEqual({ text: `${id} side ${p}` });
      expect(await proof(id, p), `${id} ${p}`).toEqual({ transcript: `${id} proof ${p}` });
    }
    expect(await one("SELECT text FROM case_appeals WHERE case_id = 'case-kid-b'")).toEqual({ text: "case-kid-b appeal a" });
    for (const id of ["case-kid-a", "case-kid-b", "case-kid-c", "case-others"]) {
      expect((await one("SELECT input FROM verdicts WHERE id = ?", [`${id}-v`])).input).toBe(`${id} both sides read`);
    }
    expect((await one("SELECT input FROM verdicts WHERE id = ?", [adultVerdict])).input).toBe("adult-v1 says Party A owes him");
    expect((await one("SELECT input FROM verdicts WHERE id = ?", [youngVerdict])).input).not.toBe("");
    // The consent ledger keeps its rows, cut loose from the account.
    expect(await all("SELECT 1 FROM consent_ledger WHERE user_id = 'kid'")).toEqual([]);
    expect(Number((await one("SELECT count(*) AS n FROM consent_ledger WHERE unlinked_at IS NOT NULL")).n)).toBeGreaterThan(0);
    expect(await all("SELECT 1 FROM consent_state WHERE user_id = 'kid'")).toEqual([]);

    // Nothing is left for the next day; the 3-day block waits for its 7th, the seat holder's block (3 days) goes with it; a block of the former rule never goes.
    expect((await runCleanup(NOW)).blocked).toBe(0);
    expect(await one('SELECT id FROM "user" WHERE id = ?', ["young"])).toEqual({ id: "young" });
    expect((await runCleanup(new Date(NOW.getTime() + 5 * DAY))).blocked).toBe(2);
    expect(await one('SELECT id FROM "user" WHERE id = ?', ["young"])).toBeUndefined();
    expect(await one('SELECT id FROM "user" WHERE id = ?', ["old"])).toEqual({ id: "old" });
  });
});

describe("legal hold", () => {
  it("keeps held verdicts and held cases whole, with the child's sides in them", async () => {
    await user("held", 9);
    const d = await getDb();
    const heldVerdict = await verdict("held-v1", "held");
    const freeVerdict = await verdict("held-v2", "held");
    await d.execute({ sql: "UPDATE verdicts SET legal_hold = 1 WHERE id = ?", args: [heldVerdict] });
    await d.execute({
      sql: "INSERT INTO verdict_appeals (id, verdict_id, text, base_id, created_at, updated_at) VALUES ('held-r1', ?, 'round text', ?, ?, ?)",
      args: [heldVerdict, heldVerdict, ago(1), ago(1)],
    });
    const caseHeld = await makeCase("case-held", "held", "pal");
    await d.execute("UPDATE cases SET legal_hold = 1 WHERE id = 'case-held'");
    const caseVerdictHeld = await makeCase("case-vheld", "held", "pal");
    await d.execute({ sql: "UPDATE verdicts SET legal_hold = 1 WHERE id = ?", args: [`case-vheld-v`] });

    expect((await runCleanup(NOW)).blocked).toBe(1);

    expect(await one('SELECT id FROM "user" WHERE id = ?', ["held"])).toBeUndefined();
    expect((await one("SELECT input FROM verdicts WHERE id = ?", [heldVerdict])).input).toBe("held-v1 says Party A owes him");
    expect((await one("SELECT text FROM verdict_appeals WHERE id = 'held-r1'")).text).toBe("round text");
    expect((await one("SELECT input FROM verdicts WHERE id = ?", [freeVerdict])).input).toBe("");
    for (const id of ["case-held", "case-vheld"]) {
      expect(await one("SELECT text FROM case_sides WHERE case_id = ? AND party = 'a'", [id])).toEqual({ text: `${id} side a` });
      expect(await one("SELECT transcript FROM case_evidence WHERE case_id = ? AND party = 'a'", [id])).toEqual({ transcript: `${id} proof a` });
      expect(await one("SELECT text FROM case_appeals WHERE case_id = ?", [id])).toEqual({ text: `${id} appeal a` });
    }
    expect((await one("SELECT input FROM verdicts WHERE id = ?", [caseHeld])).input).toBe("case-held both sides read");
    expect((await one("SELECT input FROM verdicts WHERE id = ?", [caseVerdictHeld])).input).toBe("case-vheld both sides read");
  });
});

describe("a block made final before age_block_final_at existed", () => {
  it("still gets its 7 days, counted from the first cleanup that sees it", async () => {
    const d = await getDb();
    await d.execute({
      sql: `INSERT INTO "user" (id, email, age_blocked_at, age_block_final) VALUES ('legacy', 'legacy@example.test', ?, '1')`,
      args: [ago(60)],
    });
    const T = new Date(NOW.getTime() + 20 * DAY);
    const at = (days: number) => new Date(T.getTime() + days * DAY);
    expect((await runCleanup(T)).blocked).toBe(0);
    expect((await one('SELECT age_block_final_at FROM "user" WHERE id = ?', ["legacy"])).age_block_final_at).toBe(T.toISOString());
    expect((await runCleanup(at(6))).blocked).toBe(0);
    expect(await one('SELECT id FROM "user" WHERE id = ?', ["legacy"])).toEqual({ id: "legacy" });
    expect((await runCleanup(at(8))).blocked).toBe(1);
    expect(await one('SELECT id FROM "user" WHERE id = ?', ["legacy"])).toBeUndefined();
  });
});
