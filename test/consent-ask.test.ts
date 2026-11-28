import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/** GET /api/v1/me/consent: `ask` is true only for an undecided account with two finished verdicts. */

const m = vi.hoisted(() => ({ getViewer: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  getViewer: m.getViewer,
  isSameOrigin: () => true,
  resolveViewer: async (req: Request) => ({ viewer: (await m.getViewer(req)) ?? null, deadBearer: false }),
  hasDeadBearer: async () => false,
}));
vi.mock("@/lib/ratelimit", () => ({ checkUserLimits: async () => ({ ok: true }) }));

const dir = mkdtempSync(path.join(tmpdir(), "verdict-ask-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { saveVerdictWithOriginals } = await import("../lib/originals/save");
const consentRoute = await import("../app/api/v1/me/consent/route");
const { getDb } = await import("../lib/db");
// The real table comes from Better Auth, which these tests do not load.
await (await getDb()).execute('CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, age_confirmed_at TEXT, age_blocked_at TEXT, age_block_final TEXT, age_block_final_at TEXT, age_dob TEXT, age_dob_at TEXT, age_signal TEXT, age_signal_at TEXT)');
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
  headline: "h",
  crux: "c",
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

let n = 0;
async function verdict(userId: string) {
  await saveVerdictWithOriginals({
    id: `ask${++n}`,
    input: "x",
    result: RESULT,
    kind: "premium",
    ownerUserId: userId,
    original: { v: 1, text: "raw", nameMap: [] },
  });
}

async function caseVerdict(caseId: string, owner: string, respondent: string | null, invitee: string | null = null) {
  const db = await getDb();
  const now = "2026-11-01T00:00:00.000Z";
  await db.execute({
    sql: `INSERT INTO cases (id, owner_id, status, mode, framework, lang, invite_nonce, invite_hash, respondent_user_id,
            sides, expires_at, created_at, updated_at)
          VALUES (?, ?, 'judged', 'two_sided', '{}', 'en', 'n', ?, ?, 2, ?, ?, ?)`,
    args: [caseId, owner, `h-${caseId}`, respondent, now, now, now],
  });
  if (invitee) {
    await db.execute({
      sql: "INSERT INTO case_invites (case_id, party, invite_nonce, invite_hash, user_id, created_at, updated_at) VALUES (?, 'c', 'n', ?, ?, ?, ?)",
      args: [caseId, `i-${caseId}`, invitee, now, now],
    });
  }
  for (const seq of [1, 2]) {
    const id = `${caseId}-v${seq}`;
    await db.execute({ sql: "INSERT INTO verdicts (id, input, framework, result) VALUES (?, 'x', '{}', ?)", args: [id, JSON.stringify(RESULT)] });
    await db.execute({
      sql: "INSERT INTO case_verdicts (case_id, seq, verdict_id, mode, created_at) VALUES (?, ?, ?, 'two_sided', ?)",
      args: [caseId, seq, id, now],
    });
  }
}

beforeEach(() => {
  m.getViewer.mockImplementation(async (r: Request) => {
    const id = r.headers.get("x-test-user");
    return id
      ? { user: { id, email: `${id}@verdict.local`, name: "N", image: null }, sessionId: "s", via: "bearer", age: { confirmed: true, blocked: false } }
      : null;
  });
});

const status = async (user: string) =>
  (await consentRoute.GET(new Request("http://localhost/api/v1/me/consent", { headers: { "x-test-user": user, authorization: "Bearer t" } }))).json();
const choose = (user: string, choice: "on" | "off") =>
  consentRoute.POST(
    new Request("http://localhost/api/v1/me/consent", {
      method: "POST",
      headers: { "x-test-user": user, authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify({ choice, source: "card", wordingKey: "consent.cardBody", lang: "en", platform: "web" }),
    }),
  );

describe("consent ask", () => {
  it("asks only after the second finished one-sided verdict", async () => {
    expect((await status("u-none")).ask).toBe(false);
    await verdict("u-one");
    expect((await status("u-one")).ask).toBe(false);
    await verdict("u-one");
    expect(await status("u-one")).toMatchObject({ state: "not_asked", ask: true });
  });

  it("counts case verdicts for every party, once per case however many rounds", async () => {
    await caseVerdict("c-ask-1", "u-co", "u-cr", "u-ci");
    for (const user of ["u-co", "u-cr", "u-ci"]) expect((await status(user)).ask, user).toBe(false);
    await verdict("u-co");
    await verdict("u-cr");
    expect((await status("u-co")).ask).toBe(true);
    expect((await status("u-cr")).ask).toBe(true);
    expect((await status("u-ci")).ask).toBe(false);
    await caseVerdict("c-ask-2", "u-x", "u-ci");
    expect((await status("u-ci")).ask).toBe(true);
  });

  it("stops asking once the account has answered, either way", async () => {
    await verdict("u-ans");
    await verdict("u-ans");
    expect((await status("u-ans")).ask).toBe(true);
    const res = await choose("u-ans", "off");
    expect(await res.json()).toMatchObject({ state: "off", ask: false });
    expect(await status("u-ans")).toMatchObject({ state: "off", ask: false });
  });

  it("does not count another account's verdicts or a round of added context", async () => {
    await verdict("u-other");
    await verdict("u-other");
    expect((await status("u-mine")).ask).toBe(false);
    await verdict("u-round");
    await verdict("u-round");
    const db = await getDb();
    // The second one is a round of added context on the first.
    await db.execute({
      sql: "INSERT INTO verdict_appeals (id, verdict_id, text, base_id, created_at, updated_at) VALUES (?, ?, 't', ?, 'x', 'x')",
      args: [`ask${n}`, `ask${n - 1}`, `ask${n - 1}`],
    });
    expect((await status("u-round")).ask).toBe(false);
  });
});
