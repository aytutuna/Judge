import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The 30-day wipe against a real (temporary) database: one-sided verdicts
 * with their rounds, cases removed by one or every party, the legal hold, and
 * that no row is ever deleted.
 */

const dir = mkdtempSync(path.join(tmpdir(), "verdict-erasure-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { saveVerdictWithOriginals } = await import("../lib/originals/save");
const { getVerdictMeta } = await import("../lib/originals/db");
const { removeVerdict, removeCaseSide } = await import("../lib/originals/removal");
const { getCase } = await import("../lib/cases/db");
const { blankResult, sweepErasures, ERASE_AFTER_MS } = await import("../lib/erasure");
const { getDb, getVerdict, saveTranslation, getTranslation } = await import("../lib/db");
const { getPublicVerdict } = await import("../lib/originals/display");
import { VerdictResult } from "../lib/types";

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
const NOW = new Date("2026-12-31T12:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

let n = 0;
const vid = () => `e${++n}${Math.random().toString(36).slice(2, 8)}`;

async function db() {
  return getDb();
}
async function all(sql: string, args: (string | number)[] = []) {
  return (await (await db()).execute({ sql, args })).rows.map((r) => ({ ...r }));
}
const one = async (sql: string, args: (string | number)[] = []) => (await all(sql, args))[0];

async function save(owner = "u-e1", id = vid()) {
  await saveVerdictWithOriginals({
    id,
    input: "Party B says Party A owes him...",
    result: RESULT,
    kind: "premium",
    ownerUserId: owner,
    original: { v: 1, text: "raw words", nameMap: [] },
  });
  await saveTranslation(id, "de", { ...RESULT, lang: "de", headline: "Partei B hat recht" });
  return id;
}

/** Marks a removal that happened `days` ago. */
async function removeAt(id: string, days: number) {
  await removeVerdict((await getVerdictMeta(id))!, "owner", new Date(ago(days)));
}

describe("blankResult", () => {
  it("keeps outcomes, numbers and enums, drops every text, and still parses as a result", () => {
    const out = JSON.parse(blankResult(JSON.stringify(RESULT)));
    expect(out).toMatchObject({
      verdict: "side_b",
      dispute_type: "values",
      confidence: 4,
      runs: ["side_b", "side_b", "split"],
      demo: false,
      lang: "en",
      tier: "premium",
      lean: { party: "b", unanimous: false, reason: "", tally: { for: 2, against: 1 } },
      panel: { models: ["strong", "strong", "quick"] },
      evidence_used: { a: 1, b: 0 },
      crux_trial: { attack: "", outcome: "survived", reasoning: "" },
      headline: "",
      why: "",
      crux: "",
      losing_side_best_point: "",
      facts_relied_on: [],
    });
    expect(out.argument_map).toEqual({ side_a: [{ claim: "", kind: "fact" }], side_b: [{ claim: "", kind: "value" }], bedrock_a: "", bedrock_b: "" });
    expect(out.fact_check.claims[0]).toEqual({ claim: "", status: "supported", summary: "", sources: [{ title: "", url: "" }] });
    expect(VerdictResult.safeParse(out).success).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/receipt|dinner|owes|fairness/i);
  });

  it("keeps the winner and votes of a verdict with many sides", () => {
    const many = { ...RESULT, parties: ["a", "b", "c"], winner: "c", votes: ["c", "c", "other"], sides: [{ party: "a", claims: [{ claim: "x", kind: "fact" }], bedrock: "y" }], others: [{ party: "a", line: "fell short" }] };
    const out = JSON.parse(blankResult(JSON.stringify(many)));
    expect(out).toMatchObject({ parties: ["a", "b", "c"], winner: "c", votes: ["c", "c", "other"], others: [{ party: "a", line: "" }] });
    expect(out.sides).toEqual([{ party: "a", claims: [{ claim: "", kind: "fact" }], bedrock: "" }]);
  });

  it("turns unreadable text into an empty object", () => {
    expect(blankResult("not json")).toBe("{}");
  });
});

describe("one-sided verdicts", () => {
  it("are erased 30 days after removal, not before, keeping outcome and dates", async () => {
    const id = await save();
    const { created_at } = await one("SELECT created_at FROM verdicts WHERE id = ?", [id]);
    await removeAt(id, 29);
    expect(await sweepErasures(NOW)).toEqual({ verdicts: 0, cases: 0 });
    expect((await one("SELECT input, erased_at FROM verdicts WHERE id = ?", [id]))).toMatchObject({ input: "Party B says Party A owes him...", erased_at: null });

    await removeAt(id, 30);
    // The first removal time stays, so 30 days from it is not reached yet.
    expect((await sweepErasures(NOW)).verdicts).toBe(0);
    const id2 = await save();
    await removeAt(id2, 31);
    const swept = await sweepErasures(NOW);
    expect(swept.verdicts).toBe(1);

    const row = await one("SELECT * FROM verdicts WHERE id = ?", [id2]);
    expect(row.input).toBe("");
    expect(row.erased_at).toBe(NOW.toISOString());
    expect(row.created_at).toBeTruthy();
    expect(JSON.parse(String(row.result))).toMatchObject({ verdict: "side_b", confidence: 4, headline: "" });
    const translation = await one("SELECT result_json FROM verdict_translations WHERE id = ?", [id2]);
    expect(JSON.parse(String(translation.result_json))).toMatchObject({ lang: "de", confidence: 4, headline: "" });
    expect(created_at).toBeTruthy();
  });

  it("a removed and erased verdict is still answered as removed, not as missing", async () => {
    const id = await save();
    await removeAt(id, 40);
    await sweepErasures(NOW);
    expect(await getVerdict(id)).not.toBeNull();
    expect(await getTranslation(id, "de")).not.toBeNull();
    expect((await getPublicVerdict(id))!.removed).toBe(true);
  });

  it("a verdict that was not removed is never touched", async () => {
    const id = await save();
    await sweepErasures(new Date(NOW.getTime() + 400 * DAY));
    expect(await one("SELECT erased_at FROM verdicts WHERE id = ?", [id])).toEqual({ erased_at: null });
  });

  it("the rounds of added context go with their first verdict, text included", async () => {
    const root = await save();
    const round = await save();
    const d = await db();
    await d.execute({
      sql: `INSERT INTO verdict_appeals (id, verdict_id, text, evidence, base_id, created_at, updated_at)
            VALUES (?, ?, 'more context', '["scan"]', ?, ?, ?)`,
      args: [round, root, root, ago(50), ago(50)],
    });
    await removeAt(root, 35);
    await sweepErasures(NOW);
    expect(await one("SELECT erased_at FROM verdicts WHERE id = ?", [round])).not.toEqual({ erased_at: null });
    expect(await one("SELECT text, evidence FROM verdict_appeals WHERE id = ?", [round])).toEqual({ text: "", evidence: "[]" });
  });

  it("legal hold keeps it intact, and releasing it lets the next sweep erase", async () => {
    const id = await save();
    await removeAt(id, 60);
    const d = await db();
    await d.execute({ sql: "UPDATE verdicts SET legal_hold = 1 WHERE id = ?", args: [id] });
    expect((await sweepErasures(NOW)).verdicts).toBe(0);
    expect(await one("SELECT input, erased_at FROM verdicts WHERE id = ?", [id])).toMatchObject({ input: "Party B says Party A owes him...", erased_at: null });
    expect(String((await one("SELECT result FROM verdicts WHERE id = ?", [id])).result)).toContain("Party B is right");
    expect(String((await one("SELECT result_json FROM verdict_translations WHERE id = ?", [id])).result_json)).toContain("Partei B hat recht");

    await d.execute({ sql: "UPDATE verdicts SET legal_hold = 0 WHERE id = ?", args: [id] });
    expect((await sweepErasures(NOW)).verdicts).toBeGreaterThanOrEqual(1);
    expect((await one("SELECT input FROM verdicts WHERE id = ?", [id])).input).toBe("");
  });

  it("runs once: a second sweep erases nothing and keeps the first stamp", async () => {
    const id = await save();
    await removeAt(id, 45);
    await sweepErasures(NOW);
    const first = await one("SELECT erased_at FROM verdicts WHERE id = ?", [id]);
    expect(await sweepErasures(new Date(NOW.getTime() + DAY))).toEqual({ verdicts: 0, cases: 0 });
    expect(await one("SELECT erased_at FROM verdicts WHERE id = ?", [id])).toEqual(first);
  });

  it("never deletes a row", async () => {
    const counts = async () => (await all("SELECT (SELECT count(*) FROM verdicts) AS v, (SELECT count(*) FROM verdict_meta) AS m, (SELECT count(*) FROM originals) AS o, (SELECT count(*) FROM verdict_translations) AS t"))[0];
    const id = await save();
    await removeAt(id, 90);
    const before = await counts();
    await sweepErasures(NOW);
    expect(await counts()).toEqual(before);
  });
});

describe("cases", () => {
  async function makeCase(id: string, parties: ("a" | "b" | "c")[], opts: { holdVerdict?: boolean } = {}) {
    const d = await db();
    const at = ago(90);
    const users = { a: "u-ca", b: "u-cb", c: "u-cc" };
    await d.execute({
      sql: `INSERT INTO cases (id, owner_id, status, mode, framework, lang, invite_nonce, invite_hash, respondent_user_id, sides, expires_at, created_at, updated_at)
            VALUES (?, 'u-ca', 'judged', 'two_sided', '{}', 'en', 'n', ?, 'u-cb', ?, ?, ?, ?)`,
      args: [id, `h-${id}`, parties.length, at, at, at],
    });
    for (const p of parties) {
      await d.execute({ sql: "INSERT INTO case_sides (case_id, party, text, submitted_at) VALUES (?, ?, ?, ?)", args: [id, p, `side ${p} text`, at] });
      await d.execute({ sql: "INSERT INTO case_evidence (id, case_id, party, seq, kind, transcript, created_at) VALUES (?, ?, ?, 1, 'chat', 'transcript', ?)", args: [`${id}-${p}`, id, p, at] });
      if (p === "c") {
        await d.execute({
          sql: "INSERT INTO case_invites (case_id, party, invite_nonce, invite_hash, user_id, created_at, updated_at) VALUES (?, 'c', 'n', ?, ?, ?, ?)",
          args: [id, `h-${id}-c`, users.c, at, at],
        });
      }
    }
    await d.execute({
      sql: `INSERT INTO case_appeals (id, case_id, party, text, status, reservation_id, attempt_token, base_seq, created_at, updated_at)
            VALUES (?, ?, 'a', 'appeal text', 'judged', 'r', 't', 1, ?, ?)`,
      args: [`${id}-ap`, id, at, at],
    });
    const verdictId = `${id}-v`;
    await d.execute({ sql: "INSERT INTO verdicts (id, input, framework, result, legal_hold) VALUES (?, 'both sides read', '{}', ?, ?)", args: [verdictId, JSON.stringify(RESULT), opts.holdVerdict ? 1 : 0] });
    await d.execute({
      sql: "INSERT INTO verdict_meta (verdict_id, kind, case_id, names_visible, created_at, updated_at) VALUES (?, 'case', ?, 1, ?, ?)",
      args: [verdictId, id, at, at],
    });
    await d.execute({ sql: "INSERT INTO case_verdicts (case_id, seq, verdict_id, mode, created_at) VALUES (?, 1, ?, 'two_sided', ?)", args: [id, verdictId, at] });
    await d.execute({ sql: "INSERT INTO verdict_translations (id, lang, result_json) VALUES (?, 'de', ?)", args: [verdictId, JSON.stringify(RESULT)] });
    return verdictId;
  }
  const removeParty = async (id: string, party: "a" | "b" | "c", days: number) =>
    removeCaseSide((await getCase(id))!, party, "owner", new Date(ago(days)));
  const texts = async (id: string) =>
    (await all("SELECT (SELECT group_concat(text) FROM case_sides WHERE case_id = ?1) AS sides, (SELECT group_concat(transcript) FROM case_evidence WHERE case_id = ?1) AS ev, (SELECT text FROM case_appeals WHERE case_id = ?1) AS ap, (SELECT input FROM verdicts WHERE id = ?1 || '-v') AS input, (SELECT erased_at FROM cases WHERE id = ?1) AS erased", [id]))[0];

  it("a party that still sees the case keeps all of it intact", async () => {
    const id = "case-one-left";
    await makeCase(id, ["a", "b"]);
    await removeParty(id, "a", 100);
    expect((await sweepErasures(NOW)).cases).toBe(0);
    expect(await texts(id)).toMatchObject({ sides: "side a text,side b text", ev: "transcript,transcript", ap: "appeal text", input: "both sides read", erased: null });
    // The verdict text is intact too.
    expect(String((await one("SELECT result FROM verdicts WHERE id = ?", [`${id}-v`])).result)).toContain("Party B is right");
  });

  it("starts the 30 days when the last party removes it", async () => {
    const id = "case-all-removed";
    await makeCase(id, ["a", "b", "c"]);
    await removeParty(id, "a", 100);
    await removeParty(id, "b", 50);
    await removeParty(id, "c", 20);
    expect((await sweepErasures(NOW)).cases).toBe(0);
    expect((await texts(id)).erased).toBeNull();

    // Eleven days on, 30 days have passed since the last removal.
    const later = new Date(NOW.getTime() + 11 * DAY);
    expect((await sweepErasures(later)).cases).toBeGreaterThanOrEqual(1);
    expect(await texts(id)).toEqual({ sides: ",,", ev: ",,", ap: "", input: "", erased: later.toISOString() });
    const verdict = await one("SELECT result, erased_at FROM verdicts WHERE id = ?", [`${id}-v`]);
    expect(verdict.erased_at).toBe(later.toISOString());
    expect(JSON.parse(String(verdict.result))).toMatchObject({ verdict: "side_b", confidence: 4, headline: "" });
    expect(String((await one("SELECT result_json FROM verdict_translations WHERE id = ?", [`${id}-v`])).result_json)).not.toContain("Party B");
    expect(await getPublicVerdict(`${id}-v`)).toMatchObject({ removed: true });
  });

  it("a party that never wrote a side does not hold the wipe back", async () => {
    const id = "case-two-parties";
    await makeCase(id, ["a", "b"]);
    await removeParty(id, "a", 80);
    await removeParty(id, "b", 70);
    expect((await sweepErasures(NOW)).cases).toBeGreaterThanOrEqual(1);
    expect((await texts(id)).erased).toBe(NOW.toISOString());
  });

  it("legal hold on one of its verdicts keeps the whole case", async () => {
    const id = "case-held";
    await makeCase(id, ["a", "b"], { holdVerdict: true });
    await removeParty(id, "a", 80);
    await removeParty(id, "b", 80);
    await sweepErasures(NOW);
    expect(await texts(id)).toMatchObject({ sides: "side a text,side b text", input: "both sides read", erased: null });

    await (await db()).execute({ sql: "UPDATE cases SET legal_hold = 1 WHERE id = ?", args: [id] });
    await (await db()).execute({ sql: "UPDATE verdicts SET legal_hold = 0 WHERE id = ?", args: [`${id}-v`] });
    await sweepErasures(NOW);
    expect((await texts(id)).erased).toBeNull();
  });

  it("never deletes a row", async () => {
    const id = "case-rows";
    await makeCase(id, ["a", "b"]);
    await removeParty(id, "a", 80);
    await removeParty(id, "b", 80);
    const count = async () =>
      (await all("SELECT (SELECT count(*) FROM cases) AS c, (SELECT count(*) FROM case_sides) AS s, (SELECT count(*) FROM case_evidence) AS e, (SELECT count(*) FROM case_appeals) AS a, (SELECT count(*) FROM case_verdicts) AS cv, (SELECT count(*) FROM verdicts) AS v"))[0];
    const before = await count();
    await sweepErasures(NOW);
    expect(await count()).toEqual(before);
    expect(ERASE_AFTER_MS).toBe(30 * DAY);
  });
});
