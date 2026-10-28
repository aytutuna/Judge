import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/** Service calls on a brand-new database, without any HTTP handler (or
 * sweep) having created the case tables first: scripts and the app call
 * these directly. */

vi.mock("@/lib/auth", () => ({
  derivedSecret: (purpose: string) => createHmac("sha256", "k").update(purpose).digest(),
  getAuth: vi.fn(),
  premiumEnabled: () => true,
}));
vi.mock("@/lib/evidence", () => ({
  anonymizeSubmission: async (input: { narrator: string; text: string }) => ({
    text: input.text.replace(/\bI\b/g, input.narrator),
    evidence: [],
    nameMap: [{ original: "I", replacement: input.narrator }],
    people: [],
  }),
  caseNameKeys: () => () => [],
  evidenceBlock: () => null,
}));
vi.mock("@/lib/cases/schedule", () => ({ scheduleJudging: () => {} }));

const dir = mkdtempSync(path.join(tmpdir(), "verdict-cases-svc-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const svc = await import("../lib/cases/service");
const { removeCaseSide } = await import("../lib/originals/removal");
const ent = await import("../lib/entitlements");

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

describe("case service on a fresh database", () => {
  it("createCase creates its own tables, then the answer and removal work", async () => {
    await ent.grantCredits({ userId: "o1", credits: 1, source: "admin", externalId: "g:o1" });
    const created = await svc.createCase({
      ownerId: "o1",
      text: "I think the bill was mine to pay in April and I paid it.",
      lang: "en",
      evidence: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.row.status).toBe("awaiting_respondent");
    expect(created.nameMap).toEqual([{ original: "I", replacement: "Party A" }]);
    const answered = await svc.respondToCase({
      row: created.row,
      userId: null,
      text: "I paid April myself because the account showed it unpaid.",
      evidence: [],
      origin: "http://localhost",
    });
    expect(answered.ok && answered.row.status).toBe("judging");
    expect(await removeCaseSide(created.row, "a", "party_a")).toEqual({ ok: false, code: "in_progress" });
  });
});
