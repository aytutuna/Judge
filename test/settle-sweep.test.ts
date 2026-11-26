import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { VerdictResult } from "../lib/types";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-settle-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
const ent = await import("../lib/entitlements");
const { saveVerdictWithOriginals } = await import("../lib/originals/save");
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

const MIN = 60_000;
let seq = 0;
const newUser = () => `settle-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

const RESULT = {
  verdict: "side_a",
  dispute_type: "factual",
  headline: "Party A paid",
  crux: "Whether the bill was paid",
  split_points: null,
  conditional: null,
  argument_map: { side_a: [{ claim: "Paid", kind: "fact" }], side_b: [{ claim: "Unpaid", kind: "fact" }], bedrock_a: "a", bedrock_b: "b" },
  facts_relied_on: [],
  losing_side_best_point: "x",
  confidence: 4,
  runs: ["side_a", "side_a", "side_b"],
  demo: false,
  tier: "premium",
  lang: "en",
} as unknown as VerdictResult;

const verdict = (id: string, ownerUserId: string) => ({
  id,
  input: "Party A says paid",
  result: RESULT,
  kind: "premium" as const,
  ownerUserId,
  original: { v: 1 as const, text: "I paid", nameMap: [] },
});

async function reserve(userId: string): Promise<string> {
  await ent.grantCredits({ userId, credits: 1, source: "admin", externalId: `g:${userId}` });
  const r = await ent.reservePremiumVerdict(userId);
  if (!r.ok) throw new Error("expected a reservation");
  return r.reservation.id;
}

async function verdictRows(id: string): Promise<number> {
  const rs = await (await getDb()).execute({ sql: "SELECT count(*) AS n FROM verdicts WHERE id = ?", args: [id] });
  return Number(rs.rows[0].n);
}

describe("a stored verdict is always charged", () => {
  it("the verdict and its consume are one write, so the sweep has nothing to hand back", async () => {
    const u = newUser();
    const rid = await reserve(u);
    await saveVerdictWithOriginals(verdict("v-settle-1", u), [ent.consumeStatement(rid, "v-settle-1", new Date().toISOString())]);
    expect(await verdictRows("v-settle-1")).toBe(1);
    await ent.sweepStaleReservations(new Date(Date.now() + 60 * MIN));
    expect((await ent.getEntitlement(u)).credits).toBe(0);
  });

  it("a settle that fails stores no verdict, and the unit can still be refunded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const u = newUser();
    const rid = await reserve(u);
    const bad = { sql: "UPDATE premium_usage SET no_such_column = 1", args: [] };
    await expect(saveVerdictWithOriginals(verdict("v-settle-2", u), [bad])).rejects.toThrow();
    expect(await verdictRows("v-settle-2")).toBe(0);
    await ent.refundPremiumVerdict(rid);
    expect((await ent.getEntitlement(u)).credits).toBe(1);
    vi.restoreAllMocks();
  });

  it("a run that is still going 15 minutes in keeps its unit; consuming it later charges it", async () => {
    const u = newUser();
    const rid = await reserve(u);
    expect(await ent.sweepStaleReservations(new Date(Date.now() + 15 * MIN))).toBe(0);
    await ent.consumePremiumVerdict(rid, "late-ok");
    await ent.sweepStaleReservations(new Date(Date.now() + 60 * MIN));
    expect((await ent.getEntitlement(u)).credits).toBe(0);
  });
});
