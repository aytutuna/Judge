import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Training consent (ledger, current state, per-verdict stamp and its
 * withdrawal) and "Fair verdict?" ratings, against a real temporary database.
 */

const m = vi.hoisted(() => ({
  getViewer: vi.fn(),
  isSameOrigin: vi.fn(),
  checkUserLimits: vi.fn(),
  checkIpLimits: vi.fn(),
  checkTranslateLimits: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getViewer: m.getViewer,
  isSameOrigin: m.isSameOrigin,
  resolveViewer: async (req: Request) => ({ viewer: (await m.getViewer(req)) ?? null, deadBearer: false }),
  hasDeadBearer: async () => false,
}));
vi.mock("@/lib/ratelimit", () => ({
  checkUserLimits: m.checkUserLimits,
  checkIpLimits: m.checkIpLimits,
  checkTranslateLimits: m.checkTranslateLimits,
}));

const dir = mkdtempSync(path.join(tmpdir(), "verdict-feedback-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { saveVerdictWithOriginals } = await import("../lib/originals/save");
const { removeVerdict } = await import("../lib/originals/removal");
const { getVerdictMeta } = await import("../lib/originals/db");
const { caseStampStatement } = await import("../lib/feedback/db");
const { entitlementWriteBatch } = await import("../lib/entitlements");
const http = await import("../lib/feedback/http");
const consentRoute = await import("../app/api/v1/me/consent/route");
const publicRoute = await import("../app/api/v1/verdicts/[id]/route");
const { getDb } = await import("../lib/db");
const { POLICY_VERSION } = await import("../lib/policy");
const { EN } = await import("../lib/i18n");
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

const ORIGIN = "http://localhost:4010";
const RESULT: VerdictResult = {
  verdict: "side_b",
  dispute_type: "values",
  headline: "Party B is right",
  crux: "Whether Party A owes Party B",
  split_points: null,
  conditional: null,
  argument_map: { side_a: [{ claim: "a", kind: "fact" }], side_b: [{ claim: "b", kind: "fact" }], bedrock_a: "a", bedrock_b: "b" },
  facts_relied_on: [],
  losing_side_best_point: "p",
  confidence: 4,
  runs: ["side_b", "side_b", "side_b"],
  demo: false,
  lang: "de",
};
const WORDING = "getVerdict";

let n = 0;
const vid = () => `f${++n}${Math.random().toString(36).slice(2, 8)}`;

async function save(userId: string, id = vid()) {
  await saveVerdictWithOriginals({
    id,
    input: "Party B says Party A owes him...",
    result: RESULT,
    kind: "premium",
    ownerUserId: userId,
    original: { v: 1, text: "raw", nameMap: [] },
  });
  return id;
}

type Opts = { user?: string; via?: "cookie" | "bearer"; cross?: boolean; body?: unknown; raw?: string };

function req(method: string, url: string, o: Opts = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (o.user) headers["x-test-user"] = o.user;
  if (o.via) headers["x-test-via"] = o.via;
  if (o.cross) headers["x-test-cross"] = "1";
  if (o.user) headers.authorization = "Bearer test";
  return new Request(`${ORIGIN}${url}`, {
    method,
    headers,
    body: o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body)),
  });
}

const getConsent = (o: Opts = {}) => consentRoute.GET(req("GET", "/api/v1/me/consent", o));
const postConsent = (body: unknown, o: Opts = {}) => consentRoute.POST(req("POST", "/api/v1/me/consent", { ...o, body }));
const choose = (choice: "on" | "off", o: Opts = {}) =>
  postConsent({ choice, source: "switch", wordingKey: WORDING, platform: "ios" }, o);
const rate = (id: string, body: unknown, o: Opts = {}) =>
  http.ratingPutHandler(req("PUT", `/api/v1/verdicts/${id}/rating`, { ...o, body }), id);
const publicGet = (id: string, o: Opts = {}) =>
  publicRoute.GET(req("GET", `/api/v1/verdicts/${id}`, o), { params: Promise.resolve({ id }) } as never);

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function all(sql: string, args: string[] = []) {
  const db = await getDb();
  return (await db.execute({ sql, args })).rows.map((r) => ({ ...r }));
}

beforeEach(() => {
  m.getViewer.mockImplementation(async (r: Request) => {
    const id = r.headers.get("x-test-user");
    if (!id) return null;
    return {
      user: { id, email: `${id}@verdict.local`, name: "Aytu Tuna", image: null },
      sessionId: `s-${id}`,
      via: r.headers.get("x-test-via") ?? "bearer",
      age: { confirmed: true, blocked: false },
    };
  });
  m.isSameOrigin.mockImplementation((r: Request) => !r.headers.get("x-test-cross"));
  m.checkUserLimits.mockResolvedValue({ ok: true });
  m.checkIpLimits.mockResolvedValue({ ok: true });
});

describe("consent: read and write", () => {
  it("is off and not asked by default, and needs a sign-in", async () => {
    expect((await getConsent()).status).toBe(401);
    const res = await getConsent({ user: "u-fresh" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await json(res)).toEqual({ state: "not_asked", updatedAt: null, policyVersion: POLICY_VERSION });
    expect(POLICY_VERSION).toBe("2026-11-14");
  });

  it("records a choice, keeps the English wording, and is never asked again", async () => {
    const res = await postConsent({ choice: "off", source: "card", wordingKey: WORDING, platform: "android" }, { user: "u-card" });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ state: "off", policyVersion: POLICY_VERSION });
    expect(await json(await getConsent({ user: "u-card" }))).toMatchObject({ state: "off" });
    const [row] = await all("SELECT * FROM consent_ledger WHERE user_id = 'u-card'");
    expect(row).toMatchObject({
      choice: "off",
      source: "card",
      policy_version: POLICY_VERSION,
      wording_key: WORDING,
      wording_text: EN.getVerdict,
      platform: "android",
    });
    expect(String(row.at)).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("refuses a bad body, an unknown wording key and a cross-site cookie write", async () => {
    const bad = [
      {},
      { choice: "maybe", source: "card", wordingKey: WORDING, platform: "ios" },
      { choice: "on", source: "card", wordingKey: "no.such.key", platform: "ios" },
      { choice: "on", source: "card", wordingKey: WORDING, platform: "desktop" },
      { choice: "on", source: "card", wordingKey: WORDING, platform: "ios", extra: 1 },
    ];
    for (const body of bad) {
      const res = await postConsent(body, { user: "u-bad" });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await json<{ code: string }>(res)).code).toBe("invalid");
    }
    expect((await postConsent("nope", { user: "u-bad", raw: "{" })).status).toBe(400);
    expect((await choose("on")).status).toBe(401);
    const cross = await choose("on", { user: "u-bad", via: "cookie", cross: true });
    expect(cross.status).toBe(403);
    expect((await json<{ code: string }>(cross)).code).toBe("bad_origin");
    expect(await all("SELECT 1 FROM consent_ledger WHERE user_id = 'u-bad'")).toHaveLength(0);
    expect(await json(await getConsent({ user: "u-bad" }))).toMatchObject({ state: "not_asked" });
  });

  it("appends a ledger row for every choice and refuses to change or delete one", async () => {
    for (const c of ["on", "off", "on", "on"] as const) expect((await choose(c, { user: "u-ledger" })).status).toBe(200);
    const rows = await all("SELECT choice FROM consent_ledger WHERE user_id = 'u-ledger' ORDER BY id");
    expect(rows.map((r) => r.choice)).toEqual(["on", "off", "on", "on"]);
    const db = await getDb();
    await expect(db.execute("UPDATE consent_ledger SET choice = 'off' WHERE user_id = 'u-ledger'")).rejects.toThrow(/append-only/);
    await expect(db.execute("DELETE FROM consent_ledger WHERE user_id = 'u-ledger'")).rejects.toThrow(/append-only/);
    expect(await all("SELECT 1 FROM consent_ledger WHERE user_id = 'u-ledger'")).toHaveLength(4);
    expect(await json(await getConsent({ user: "u-ledger" }))).toMatchObject({ state: "on" });
  });

  it("503 when the write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.checkUserLimits.mockRejectedValueOnce(new Error("redis down"));
    expect((await choose("on", { user: "u-down" })).status).toBe(503);
    vi.restoreAllMocks();
  });
});

describe("consent: which verdicts may train", () => {
  it("a verdict made without consent is never stamped, one made with consent is", async () => {
    const before = await save("u-train");
    await choose("on", { user: "u-train" });
    const after = await save("u-train");
    expect(await getVerdictMeta(before)).toBeTruthy();
    const [b] = await all("SELECT * FROM verdict_meta WHERE verdict_id = ?", [before]);
    const [a] = await all("SELECT * FROM verdict_meta WHERE verdict_id = ?", [after]);
    expect(b.training_ok_at).toBeNull();
    expect(a.training_ok_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(a.training_withdrawn_at).toBeNull();
    // The dataset fields every new verdict keeps.
    expect(a).toMatchObject({ policy_version: POLICY_VERSION, lang: "de", sides: 2 });
    expect(b).toMatchObject({ policy_version: POLICY_VERSION, lang: "de", sides: 2 });
  });

  it("a card answer of no thanks stamps nothing", async () => {
    await postConsent({ choice: "off", source: "card", wordingKey: WORDING, platform: "web" }, { user: "u-no" });
    const id = await save("u-no");
    const [row] = await all("SELECT training_ok_at FROM verdict_meta WHERE verdict_id = ?", [id]);
    expect(row.training_ok_at).toBeNull();
  });

  it("turning it off withdraws the account's verdicts only, and turning it on again does not bring them back", async () => {
    await choose("on", { user: "u-w1" });
    await choose("on", { user: "u-w2" });
    const mine = [await save("u-w1"), await save("u-w1")];
    const theirs = await save("u-w2");
    await choose("off", { user: "u-w1" });
    const state = async (id: string) => (await all("SELECT training_ok_at, training_withdrawn_at FROM verdict_meta WHERE verdict_id = ?", [id]))[0];
    for (const id of mine) {
      const row = await state(id);
      expect(row.training_ok_at).not.toBeNull();
      expect(row.training_withdrawn_at).not.toBeNull();
    }
    expect((await state(theirs)).training_withdrawn_at).toBeNull();

    await choose("on", { user: "u-w1" });
    expect((await state(mine[0])).training_withdrawn_at).not.toBeNull();
    const fresh = await save("u-w1");
    expect(await state(fresh)).toMatchObject({ training_withdrawn_at: null });
    expect((await state(fresh)).training_ok_at).not.toBeNull();
  });

  describe("a case", () => {
    const now = "2026-11-01T00:00:00.000Z";

    async function makeCase(id: string, owner: string, respondent: string | null, extra: [string, string | null][] = []) {
      const db = await getDb();
      await db.execute({
        sql: `INSERT INTO cases (id, owner_id, status, mode, framework, lang, invite_nonce, invite_hash, respondent_user_id,
                sides, expires_at, created_at, updated_at)
              VALUES (?, ?, 'judged', 'two_sided', '{}', 'en', 'n', ?, ?, ?, ?, ?, ?)`,
        args: [id, owner, `h-${id}`, respondent, 2 + extra.length, now, now, now],
      });
      const parties: [string, string | null][] = [["a", owner], ["b", respondent], ...extra];
      for (const [party] of parties) {
        await db.execute({ sql: "INSERT INTO case_sides (case_id, party, text, submitted_at) VALUES (?, ?, 't', ?)", args: [id, party, now] });
      }
      for (const [party, userId] of extra) {
        await db.execute({
          sql: "INSERT INTO case_invites (case_id, party, invite_nonce, invite_hash, user_id, created_at, updated_at) VALUES (?, ?, 'n', ?, ?, ?, ?)",
          args: [id, party, `h-${id}-${party}`, userId, now, now],
        });
      }
      const verdictId = `${id}-v`;
      await db.execute({ sql: "INSERT INTO verdicts (id, input, framework, result) VALUES (?, 'x', '{}', ?)", args: [verdictId, JSON.stringify(RESULT)] });
      await db.execute({
        sql: "INSERT INTO verdict_meta (verdict_id, kind, case_id, names_visible, created_at, updated_at) VALUES (?, 'case', ?, 1, ?, ?)",
        args: [verdictId, id, now, now],
      });
      await db.execute({ sql: "INSERT INTO case_verdicts (case_id, seq, verdict_id, mode, created_at) VALUES (?, 1, ?, 'two_sided', ?)", args: [id, verdictId, now] });
      return verdictId;
    }
    const stamp = async (verdictId: string, caseId: string) => {
      await entitlementWriteBatch([caseStampStatement(verdictId, caseId, now)]);
      return (await all("SELECT training_ok_at FROM verdict_meta WHERE verdict_id = ?", [verdictId]))[0].training_ok_at;
    };

    it("is stamped only when every party has consent on, and withdrawn when any of them turns it off", async () => {
      await save("u-warm");
      await choose("on", { user: "u-ca" });
      await choose("on", { user: "u-cb" });
      await choose("on", { user: "u-cc" });
      await choose("off", { user: "u-cd" });

      expect(await stamp(await makeCase("c-all", "u-ca", "u-cb", [["c", "u-cc"]]), "c-all")).toBe(now);
      expect(await stamp(await makeCase("c-refuses", "u-ca", "u-cb", [["c", "u-cd"]]), "c-refuses")).toBeNull();
      expect(await stamp(await makeCase("c-guest", "u-ca", null), "c-guest")).toBeNull();
      expect(await stamp(await makeCase("c-nobody", "u-nobody", "u-cb"), "c-nobody")).toBeNull();

      await choose("off", { user: "u-cc" });
      const [row] = await all("SELECT training_withdrawn_at FROM verdict_meta WHERE verdict_id = 'c-all-v'");
      expect(row.training_withdrawn_at).not.toBeNull();
    });
  });
});

describe("ratings", () => {
  it("sets, changes and clears one rating per viewer, kept with the verdict", async () => {
    const id = await save("u-owner");
    const rating = async (user: string) =>
      (await json<{ rating?: string | null }>(await publicGet(id, { user }))).rating;

    expect(await json(await rate(id, { rating: "up" }, { user: "u-r1" }))).toEqual({ rating: "up" });
    expect(await json(await rate(id, { rating: "down" }, { user: "u-r1" }))).toEqual({ rating: "down" });
    await rate(id, { rating: "up" }, { user: "u-r2" });
    expect(await rating("u-r1")).toBe("down");
    expect(await rating("u-r2")).toBe("up");
    expect(await rating("u-r3")).toBeNull();

    expect(await json(await rate(id, { rating: null }, { user: "u-r1" }))).toEqual({ rating: null });
    expect(await rating("u-r1")).toBeNull();
    expect(await rating("u-r2")).toBe("up");
    // The row stays, with no rating.
    const rows = await all("SELECT user_id, rating FROM verdict_ratings WHERE verdict_id = ? ORDER BY user_id", [id]);
    expect(rows).toEqual([
      { user_id: "u-r1", rating: null },
      { user_id: "u-r2", rating: "up" },
    ]);
  });

  it("is left out of the public read for a signed-out viewer", async () => {
    const id = await save("u-owner2");
    const body = await json(await publicGet(id));
    expect(body).not.toHaveProperty("rating");
    expect(body).toMatchObject({ id, status: "ready" });
  });

  it("needs a sign-in, a good body and a verdict that exists, is shown and is ready", async () => {
    const id = await save("u-owner3");
    expect((await rate(id, { rating: "up" })).status).toBe(401);
    expect((await json<{ code: string }>(await rate(id, { rating: "up" }))).code).toBe("signin_required");
    for (const body of [{}, { rating: "meh" }, { rating: "up", x: 1 }, "up"]) {
      expect((await rate(id, body, { user: "u-r1" })).status, JSON.stringify(body)).toBe(400);
    }
    expect((await rate("nope", { rating: "up" }, { user: "u-r1" })).status).toBe(404);
    expect((await rate("bad id!", { rating: "up" }, { user: "u-r1" })).status).toBe(404);
    expect((await rate(id, { rating: "up" }, { user: "u-r1", via: "cookie", cross: true })).status).toBe(403);

    const db = await getDb();
    await db.execute({
      sql: `INSERT INTO verdict_jobs (id, kind, status, created_at, updated_at) VALUES ('judging1', 'premium', 'judging', ?, ?)`,
      args: ["2026-11-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"],
    });
    expect((await rate("judging1", { rating: "up" }, { user: "u-r1" })).status).toBe(404);
    expect(await all("SELECT 1 FROM verdict_ratings WHERE verdict_id IN ('nope', 'judging1')")).toHaveLength(0);
  });

  it("410 on a removed verdict, and the earlier rating stays in the table", async () => {
    const id = await save("u-owner4");
    await rate(id, { rating: "up" }, { user: "u-r1" });
    await removeVerdict((await getVerdictMeta(id))!, "owner");
    const res = await rate(id, { rating: "down" }, { user: "u-r1" });
    expect(res.status).toBe(410);
    expect((await json<{ code: string }>(res)).code).toBe("removed");
    expect(await all("SELECT rating FROM verdict_ratings WHERE verdict_id = ?", [id])).toEqual([{ rating: "up" }]);
  });

  it("429 when the viewer is rate limited", async () => {
    const id = await save("u-owner5");
    m.checkUserLimits.mockResolvedValueOnce({ ok: false, code: "rate_limited", retryAfterSec: 30 });
    const res = await rate(id, { rating: "up" }, { user: "u-r1" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });
});
