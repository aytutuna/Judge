import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The writer's endpoints for one-sided verdicts against a real (temporary)
 * database: ownership by session or owner token, display names, removal,
 * claim, the account list, and the public reads after removal.
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

const dir = mkdtempSync(path.join(tmpdir(), "verdict-owner-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { saveVerdictWithOriginals } = await import("../lib/originals/save");
const ohttp = await import("../lib/originals/http");
const publicRoute = await import("../app/api/v1/verdicts/[id]/route");
const translateRoute = await import("../app/api/verdict/[id]/translate/route");
const { getDb } = await import("../lib/db");
import type { DisplayState, MineResponse, OwnerVerdictListResponse } from "../lib/originals-types";
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
  lang: "en",
};
const RAW = "  Harry says I owe him £20 for the concert; Leo backs him up. I paid for dinner, so we're even.  ";
const MAP = [
  { original: "I", replacement: "Party A" },
  { original: "Harry Potter", replacement: "Party B" },
  { original: "Leo", replacement: "Person C" },
];

let n = 0;
const vid = () => `v${++n}${Math.random().toString(36).slice(2, 8)}`;

async function save(ownerUserId: string | null, id = vid()) {
  const out = await saveVerdictWithOriginals({
    id,
    input: "Party B says Party A owes him...",
    framework: { preset: "balanced" },
    result: RESULT,
    kind: ownerUserId ? "premium" : "free",
    ownerUserId,
    original: { v: 1, text: RAW, nameMap: MAP },
  });
  return { id, ...out };
}

type Opts = { user?: string; via?: "cookie" | "bearer"; token?: string; cross?: boolean; body?: unknown; name?: string };

function req(method: string, url: string, o: Opts = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (o.user) headers["x-test-user"] = o.user;
  if (o.via) headers["x-test-via"] = o.via;
  if (o.name) headers["x-test-name"] = o.name;
  if (o.token) headers["x-owner-token"] = o.token;
  if (o.cross) headers["x-test-cross"] = "1";
  return new Request(`${ORIGIN}${url}`, {
    method,
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
}

const mine = (id: string, o: Opts = {}) => ohttp.mineHandler(req("GET", `/api/v1/verdicts/${id}/mine`, o), id);
const patchDisplay = (id: string, body: unknown, o: Opts = {}) =>
  ohttp.displayHandler(req("PATCH", `/api/v1/verdicts/${id}/display`, { ...o, body }), id);
const remove = (id: string, o: Opts = {}, body: unknown = { confirm: "remove" }) =>
  ohttp.removalHandler(req("POST", `/api/v1/verdicts/${id}/removal`, { ...o, body }), id);
const publicGet = (id: string) =>
  publicRoute.GET(new Request(`${ORIGIN}/api/v1/verdicts/${id}`), { params: Promise.resolve({ id }) } as never);

async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

beforeEach(() => {
  m.getViewer.mockImplementation(async (r: Request) => {
    const id = r.headers.get("x-test-user");
    if (!id) return null;
    return {
      user: { id, email: `${id}@verdict.local`, name: r.headers.get("x-test-name") ?? "Aytu Tuna", image: null },
      sessionId: `s-${id}`,
      via: r.headers.get("x-test-via") ?? "bearer",
    };
  });
  m.isSameOrigin.mockImplementation((r: Request) => !r.headers.get("x-test-cross"));
  m.checkUserLimits.mockResolvedValue({ ok: true });
  m.checkIpLimits.mockResolvedValue({ ok: true });
  m.checkTranslateLimits.mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("saving with originals", () => {
  it("signed out: an owner token, a sealed original and first-name defaults for the others", async () => {
    const saved = await save(null);
    expect(saved.ownerToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(saved.originalsStored).toBe(true);
    expect(saved.display).toEqual({ namesVisible: true, a: null, b: "Harry", others: { "Person C": "Leo" } });
    const db = await getDb();
    const meta = (await db.execute({ sql: "SELECT * FROM verdict_meta WHERE verdict_id = ?", args: [saved.id] })).rows[0];
    expect(meta.owner_user_id).toBeNull();
    expect(String(meta.owner_token_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(meta)).not.toContain(saved.ownerToken!);
    expect(String(meta.display_sealed)).toMatch(/^v1\./);
    const orig = (await db.execute({ sql: "SELECT * FROM originals WHERE verdict_id = ?", args: [saved.id] })).rows[0];
    expect(String(orig.sealed)).toMatch(/^v1\./);
    expect(String(orig.sealed)).not.toContain("Harry");
    // The verdict row holds only the anonymized text.
    const v = (await db.execute({ sql: "SELECT input FROM verdicts WHERE id = ?", args: [saved.id] })).rows[0];
    expect(String(v.input)).not.toContain("Harry");
  });

  it("signed in: owned by the account, no token", async () => {
    const saved = await save("u-own");
    expect(saved.ownerToken).toBeNull();
    expect(saved.metaWritten).toBe(true);
  });

  it("production without a key: the verdict is saved, nothing personal is, and the page shows labels", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ORIGINALS_KEY", "");
    const saved = await save(null);
    expect(saved.originalsStored).toBe(false);
    expect(saved.metaWritten).toBe(true);
    expect(saved.display).toEqual({ namesVisible: true, a: null, b: null, others: {} });
    const db = await getDb();
    expect(Number((await db.execute({ sql: "SELECT count(*) AS n FROM originals WHERE verdict_id = ?", args: [saved.id] })).rows[0].n)).toBe(0);
    expect((await json(await publicGet(saved.id))).display).toBeNull();
  });

  it("a failing ownership write falls back to the plain verdict", async () => {
    const id = vid();
    const db = await getDb();
    await db.execute({
      sql: "INSERT INTO verdict_meta (verdict_id, kind, created_at, updated_at) VALUES (?, 'free', 'x', 'x')",
      args: [id],
    });
    const saved = await save(null, id);
    expect(saved).toMatchObject({ ownerToken: null, originalsStored: false, metaWritten: false });
    expect(Number((await db.execute({ sql: "SELECT count(*) AS n FROM verdicts WHERE id = ?", args: [id] })).rows[0].n)).toBe(1);
  });
});

describe("GET /api/v1/verdicts/{id}/mine", () => {
  it("by owner token: the original as written, the map, the display names", async () => {
    const saved = await save(null);
    const res = await mine(saved.id, { token: saved.ownerToken! });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json<MineResponse>(res);
    expect(body.via).toBe("token");
    expect(body.original?.text).toBe(RAW);
    expect(body.originalStatus).toBe("stored");
    expect(body.nameMap).toEqual(MAP);
    expect(body.display).toEqual({ namesVisible: true, a: null, b: "Harry", others: { "Person C": "Leo" } });
    expect(body.removed).toBeNull();
    expect(body.result?.headline).toBe("Party B is right");
  });

  it("by session for account-owned verdicts, with the account's first name as a suggestion", async () => {
    const saved = await save("u-sess");
    const body = await json<MineResponse>(await mine(saved.id, { user: "u-sess", via: "cookie" }));
    expect(body.via).toBe("session");
    expect(body.suggested).toEqual({ a: "Aytu" });
  });

  it("everyone else gets the same 404: wrong or malformed token, another account, no credentials, unknown id", async () => {
    const saved = await save(null);
    const owned = await save("u-a");
    const other = await save(null);
    expect((await mine(saved.id, { token: other.ownerToken! })).status).toBe(404);
    expect((await mine(saved.id, { token: "short" })).status).toBe(404);
    expect((await mine(saved.id)).status).toBe(404);
    expect((await mine(owned.id, { user: "u-b" })).status).toBe(404);
    expect((await mine("doesnotexist", { token: saved.ownerToken! })).status).toBe(404);
    expect((await mine("bad id!", { token: saved.ownerToken! })).status).toBe(404);
    // A verdict stored before this feature has no owner at all.
    const db = await getDb();
    await db.execute({ sql: "INSERT INTO verdicts (id, input, framework, result) VALUES ('legacy01', 'x', '{}', ?)", args: [JSON.stringify(RESULT)] });
    expect((await mine("legacy01", { user: "u-a" })).status).toBe(404);
  });

  it("is rate limited (fails closed)", async () => {
    const saved = await save(null);
    m.checkIpLimits.mockResolvedValueOnce({ ok: false, code: "rate_limited", retryAfterSec: 30 });
    const res = await mine(saved.id, { token: saved.ownerToken! });
    expect(res.status).toBe(429);
    m.checkIpLimits.mockResolvedValueOnce({ ok: false, code: "unavailable", error: "x" });
    expect((await mine(saved.id, { token: saved.ownerToken! })).status).toBe(503);
  });
});

describe("PATCH /api/v1/verdicts/{id}/display", () => {
  it("saves the writer's name and edits; the public read and switch follow", async () => {
    const saved = await save(null);
    const t = saved.ownerToken!;
    let res = await patchDisplay(saved.id, { a: "Aytu", others: { "Person C": null } }, { token: t });
    expect(res.status).toBe(200);
    const d = (await json<{ display: DisplayState }>(res)).display;
    expect(d).toEqual({ namesVisible: true, a: "Aytu", b: "Harry", others: {} });
    expect((await json(await publicGet(saved.id))).display).toEqual({ a: "Aytu", b: "Harry", others: {} });
    res = await patchDisplay(saved.id, { namesVisible: false }, { token: t });
    expect((await json<{ display: DisplayState }>(res)).display.namesVisible).toBe(false);
    expect((await json(await publicGet(saved.id))).display).toBeNull();
    // Names are kept while hidden, so switching back restores them.
    await patchDisplay(saved.id, { namesVisible: true }, { token: t });
    expect((await json(await publicGet(saved.id))).display).toEqual({ a: "Aytu", b: "Harry", others: {} });
  });

  it("refuses labels, bad keys, control characters and unknown fields", async () => {
    const saved = await save(null);
    const t = saved.ownerToken!;
    for (const body of [
      { a: "Party A" },
      { b: "Taraf B'ye" },
      { a: "Kişi C" },
      { others: { "Person 1": "Leo" } },
      { a: "x".repeat(41) },
      { a: "a\u0000b" },
      { a: "<b>" },
      { extra: true },
    ]) {
      const res = await patchDisplay(saved.id, body, { token: t });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("cookie writes need the same origin; a non-owner is 404", async () => {
    const saved = await save("u-c");
    expect((await patchDisplay(saved.id, { a: "A" }, { user: "u-c", via: "cookie", cross: true })).status).toBe(403);
    expect((await patchDisplay(saved.id, { a: "A" }, { user: "u-c", via: "cookie" })).status).toBe(200);
    expect((await patchDisplay(saved.id, { a: "A" }, { user: "u-x" })).status).toBe(404);
  });

  it("without a key, names cannot be saved (503 names_unavailable) but the switch still works", async () => {
    const saved = await save(null);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ORIGINALS_KEY", "");
    const res = await patchDisplay(saved.id, { a: "Aytu" }, { token: saved.ownerToken! });
    expect(res.status).toBe(503);
    expect((await json(res)).code).toBe("names_unavailable");
    expect((await patchDisplay(saved.id, { namesVisible: false }, { token: saved.ownerToken! })).status).toBe(200);
  });
});

describe("removal", () => {
  it("blanks the original and names, keeps the row, closes the public read and translation; idempotent", async () => {
    const saved = await save(null);
    const t = saved.ownerToken!;
    expect((await remove(saved.id, { token: t }, { confirm: "yes" })).status).toBe(400);
    expect((await remove(saved.id, { token: "x".repeat(43) })).status).toBe(404);
    const res = await remove(saved.id, { token: t });
    expect(res.status).toBe(200);
    const first = await json<{ removed: boolean; removedAt: string }>(res);
    expect(first.removed).toBe(true);
    expect((await json(await remove(saved.id, { token: t }))).removedAt).toBe(first.removedAt);

    const pub = await publicGet(saved.id);
    expect(pub.status).toBe(410);
    expect((await json(pub)).code).toBe("removed");
    const tr = await translateRoute.POST(
      new Request(`${ORIGIN}/api/verdict/${saved.id}/translate?lang=tr`, { method: "POST" }),
      { params: Promise.resolve({ id: saved.id }) } as never,
    );
    expect(tr.status).toBe(410);

    const body = await json<MineResponse>(await mine(saved.id, { token: t }));
    expect(body).toMatchObject({ result: null, original: null, originalStatus: "removed", nameMap: [] });
    expect(body.removed?.reason).toBe("owner");
    expect((await patchDisplay(saved.id, { a: "Aytu" }, { token: t })).status).toBe(410);

    const db = await getDb();
    expect(Number((await db.execute({ sql: "SELECT count(*) AS n FROM verdicts WHERE id = ?", args: [saved.id] })).rows[0].n)).toBe(1);
    const orig = (await db.execute({ sql: "SELECT sealed, removed_at FROM originals WHERE verdict_id = ?", args: [saved.id] })).rows[0];
    expect(orig.sealed).toBeNull();
    expect(orig.removed_at).not.toBeNull();
    const meta = (await db.execute({ sql: "SELECT display_sealed, names_visible FROM verdict_meta WHERE verdict_id = ?", args: [saved.id] })).rows[0];
    expect(meta.display_sealed).toBeNull();
    expect(Number(meta.names_visible)).toBe(0);
  });

  it("case verdicts are removed through the case (409)", async () => {
    const db = await getDb();
    const { ensureOriginalsTables } = await import("../lib/originals/db");
    await ensureOriginalsTables();
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO cases (id, owner_id, status, mode, framework, lang, invite_nonce, invite_hash, expires_at, created_at, updated_at)
            VALUES ('caseowner001', 'u-case', 'judged', 'two_sided', '{"preset":"balanced"}', 'en', 'n', 'h-co1', ?, ?, ?)`,
      args: [now, now, now],
    });
    await db.execute({ sql: "INSERT INTO verdicts (id, input, framework, result) VALUES ('caseV1', 'x', '{}', ?)", args: [JSON.stringify(RESULT)] });
    await db.execute({
      sql: "INSERT INTO verdict_meta (verdict_id, kind, case_id, created_at, updated_at) VALUES ('caseV1', 'case', 'caseowner001', ?, ?)",
      args: [now, now],
    });
    const body = await json<MineResponse>(await mine("caseV1", { user: "u-case" }));
    expect(body.case).toEqual({ id: "caseowner001", party: "a" });
    expect((await remove("caseV1", { user: "u-case" })).status).toBe(409);
    expect((await mine("caseV1", { user: "someone" })).status).toBe(404);
  });
});

describe("claim and the account list", () => {
  it("a signed-in writer keeps a token-owned verdict; it then shows on any device", async () => {
    const saved = await save(null);
    const claim = (o: Opts) => ohttp.claimHandler(req("POST", `/api/v1/verdicts/${saved.id}/claim`, { ...o, body: {} }), saved.id);
    expect((await claim({ token: saved.ownerToken! })).status).toBe(401);
    expect((await claim({ user: "u-claim", via: "cookie", cross: true, token: saved.ownerToken! })).status).toBe(403);
    const res = await claim({ user: "u-claim", token: saved.ownerToken! });
    expect(await json(res)).toEqual({ claimed: true });
    expect((await mine(saved.id, { user: "u-claim" })).status).toBe(200);
    // The token keeps working; another account cannot take it over.
    expect((await mine(saved.id, { token: saved.ownerToken! })).status).toBe(200);
    expect((await claim({ user: "u-other", token: saved.ownerToken! })).status).toBe(409);

    const listRes = await ohttp.myVerdictsHandler(req("GET", "/api/v1/me/verdicts", { user: "u-claim" }));
    const list = await json<OwnerVerdictListResponse>(listRes);
    expect(list.verdicts.map((v) => v.id)).toContain(saved.id);
    const item = list.verdicts.find((v) => v.id === saved.id)!;
    expect(item).toMatchObject({ kind: "free", headline: "Party B is right", removed: false, nameMap: MAP });

    await remove(saved.id, { user: "u-claim" });
    const after = await json<OwnerVerdictListResponse>(await ohttp.myVerdictsHandler(req("GET", "/api/v1/me/verdicts", { user: "u-claim" })));
    expect(after.verdicts.find((v) => v.id === saved.id)).toMatchObject({ removed: true, headline: null, nameMap: [] });
    expect((await ohttp.myVerdictsHandler(req("GET", "/api/v1/me/verdicts"))).status).toBe(401);
    expect((await ohttp.myVerdictsHandler(req("GET", "/api/v1/me/verdicts?limit=0", { user: "u-claim" }))).status).toBe(400);
  });
});

describe("names confirmed", () => {
  it("the share prompt flag is off until the writer saves, then on, even with names switched off", async () => {
    const saved = await save(null);
    const t = saved.ownerToken!;
    expect((await json<MineResponse>(await mine(saved.id, { token: t }))).namesConfirmed).toBe(false);
    const res = await patchDisplay(saved.id, { namesVisible: false, a: null }, { token: t });
    expect(res.status).toBe(200);
    expect((await json<{ namesConfirmed: boolean }>(res)).namesConfirmed).toBe(true);
    const body = await json<MineResponse>(await mine(saved.id, { token: t }));
    expect(body.namesConfirmed).toBe(true);
    expect(body.display.a).toBeNull();
  });
});

describe("removal log and replay after a restore", () => {
  it("every removal is logged outside the database; a replay re-applies it to an older copy", async () => {
    const { readRemovalLog, removalLogPath } = await import("../lib/originals/removal-log");
    const { replayRemoval } = await import("../lib/originals/removal");
    const file = removalLogPath()!;
    expect(path.dirname(file)).toBe(dir);
    const saved = await save(null);
    const removedAt = (await json<{ removedAt: string }>(await remove(saved.id, { token: saved.ownerToken! }))).removedAt;
    const log = await readRemovalLog(file);
    const entry = log!.entries.find((e) => e.id === saved.id);
    expect(entry).toEqual({ v: 1, at: removedAt, kind: "verdict", id: saved.id, reason: "owner" });
    const text = (await import("node:fs")).readFileSync(file, "utf8");
    expect(text).not.toContain("Harry");

    // A backup from before the removal: the row is open and sealed again.
    const db = await getDb();
    await db.execute({ sql: "UPDATE verdict_meta SET removed_at = NULL, removal_reason = NULL, display_sealed = 'v1.old', names_visible = 1 WHERE verdict_id = ?", args: [saved.id] });
    await db.execute({ sql: "UPDATE originals SET sealed = 'v1.old', removed_at = NULL WHERE verdict_id = ?", args: [saved.id] });
    expect((await publicGet(saved.id)).status).toBe(200);

    const before = (await readRemovalLog(file))!.entries.length;
    expect(await replayRemoval(entry!)).toBe("applied");
    expect((await publicGet(saved.id)).status).toBe(410);
    const meta = (await db.execute({ sql: "SELECT removed_at, display_sealed FROM verdict_meta WHERE verdict_id = ?", args: [saved.id] })).rows[0];
    expect(String(meta.removed_at)).toBe(removedAt);
    expect(meta.display_sealed).toBeNull();
    const orig = (await db.execute({ sql: "SELECT sealed FROM originals WHERE verdict_id = ?", args: [saved.id] })).rows[0];
    expect(orig.sealed).toBeNull();
    // A replay is not logged again; an entry for a verdict this copy lacks is skipped.
    expect((await readRemovalLog(file))!.entries.length).toBe(before);
    expect(await replayRemoval({ ...entry!, id: "notInThisCopy1" })).toBe("absent");
  });

  it("the log path follows DATABASE_URL, REMOVAL_LOG overrides it, and malformed lines are skipped", async () => {
    const { parseRemovalLogLine, removalLogPath } = await import("../lib/originals/removal-log");
    expect(removalLogPath({ DATABASE_URL: "file:/var/lib/verdict/verdict.db" } as unknown as NodeJS.ProcessEnv)?.replace(/\\/g, "/")).toBe(
      "/var/lib/verdict/removals.log",
    );
    expect(removalLogPath({ DATABASE_URL: "libsql://x.turso.io" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(removalLogPath({ DATABASE_URL: "file:x.db", REMOVAL_LOG: "off" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(removalLogPath({ REMOVAL_LOG: "/tmp/r.log" } as unknown as NodeJS.ProcessEnv)).toBe("/tmp/r.log");
    expect(parseRemovalLogLine("not json")).toBeNull();
    expect(parseRemovalLogLine('{"v":1,"at":"2026-10-20T00:00:00.000Z","kind":"verdict","id":"a b","reason":"owner"}')).toBeNull();
    expect(parseRemovalLogLine('{"v":1,"at":"2026-10-20T00:00:00.000Z","kind":"case_side","id":"c1","party":"b","reason":"party_b"}')).toEqual({
      v: 1,
      at: "2026-10-20T00:00:00.000Z",
      kind: "case_side",
      id: "c1",
      party: "b",
      reason: "party_b",
    });
  });
});
