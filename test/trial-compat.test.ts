import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ checkIpLimits: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  getViewer: async () => null,
  isSameOrigin: () => true,
  resolveViewer: async () => ({ viewer: null, deadBearer: false }),
  hasDeadBearer: async () => false,
}));
vi.mock("@/lib/ratelimit", () => ({ checkIpLimits: m.checkIpLimits }));

const dir = mkdtempSync(path.join(tmpdir(), "trial-compat-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

const { acceptsMinor, forTrialClient, trialCompat, withoutMinor } = await import("../lib/trial-compat");
const { saveVerdictWithOriginals } = await import("../lib/originals/save");
const publicRoute = await import("../app/api/v1/verdicts/[id]/route");
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
const withHeader = new Request(ORIGIN, { headers: { "Judge-Trial": "minor" } });
const without = new Request(ORIGIN);

const minorTrial = { attack: "atk", outcome: "minor", reasoning: "r" };

describe("withoutMinor", () => {
  it("turns minor into survived anywhere in the body and keeps the rest", () => {
    const body = {
      result: { confidence: 4, crux_trial: minorTrial },
      rounds: [{ result: { crux_trial: minorTrial } }, { result: { crux_trial: { ...minorTrial, outcome: "uncertain" } } }],
      note: "minor",
    };
    const out = withoutMinor(body);
    expect(out.result.crux_trial).toEqual({ attack: "atk", outcome: "survived", reasoning: "r" });
    expect(out.rounds[0].result.crux_trial.outcome).toBe("survived");
    expect(out.rounds[1].result.crux_trial.outcome).toBe("uncertain");
    expect(out.note).toBe("minor");
    expect(body.result.crux_trial.outcome).toBe("minor");
  });

  it("returns the same object when there is nothing to change", () => {
    const body = { result: { crux_trial: { ...minorTrial, outcome: "overturned" } }, list: [1, 2] };
    expect(withoutMinor(body)).toBe(body);
  });
});

describe("forTrialClient", () => {
  const reply = () => Response.json({ result: { crux_trial: minorTrial } }, { status: 201, headers: { "Cache-Control": "no-store" } });

  it("reads Judge-Trial: minor", () => {
    expect(acceptsMinor(withHeader)).toBe(true);
    expect(acceptsMinor(new Request(ORIGIN, { headers: { "Judge-Trial": "other, Minor" } }))).toBe(true);
    expect(acceptsMinor(without)).toBe(false);
  });

  it("leaves the answer alone for a client that knows minor", async () => {
    const res = await forTrialClient(withHeader, reply());
    expect(((await res.json()) as { result: { crux_trial: { outcome: string } } }).result.crux_trial.outcome).toBe("minor");
  });

  it("sends survived to a client without the header, keeping status and headers", async () => {
    const res = await forTrialClient(without, reply());
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(((await res.json()) as { result: { crux_trial: { outcome: string } } }).result.crux_trial.outcome).toBe("survived");
  });

  it("passes non-JSON answers through", async () => {
    const res = await forTrialClient(without, new Response("minor", { headers: { "content-type": "text/plain" } }));
    expect(await res.text()).toBe("minor");
  });

  it("wraps a handler", async () => {
    const wrapped = trialCompat(async (_req: Request, id: string) => Response.json({ id, crux_trial: minorTrial }));
    expect(((await (await wrapped(without, "x")).json()) as { crux_trial: { outcome: string } }).crux_trial.outcome).toBe("survived");
    expect(((await (await wrapped(withHeader, "x")).json()) as { crux_trial: { outcome: string } }).crux_trial.outcome).toBe("minor");
  });
});

describe("GET /api/v1/verdicts/{id} with a stored minor outcome", () => {
  const RESULT: VerdictResult = {
    verdict: "side_b",
    dispute_type: "factual",
    headline: "Party B is right",
    crux: "c",
    split_points: null,
    conditional: null,
    argument_map: { side_a: [{ claim: "a", kind: "fact" }], side_b: [{ claim: "b", kind: "fact" }], bedrock_a: "a", bedrock_b: "b" },
    facts_relied_on: [],
    losing_side_best_point: "p",
    confidence: 4,
    runs: ["side_b", "side_b", "side_b"],
    demo: false,
    lang: "en",
    crux_trial: { attack: "atk", outcome: "minor", reasoning: "r" },
  };

  beforeEach(() => {
    m.checkIpLimits.mockResolvedValue({ ok: true });
  });

  it("answers survived to an older app and minor to one that sends the header", async () => {
    const id = "tc1abcdef";
    await saveVerdictWithOriginals({ id, input: "Party B says...", result: RESULT, kind: "free", ownerUserId: null });
    const ctx = { params: Promise.resolve({ id }) } as never;
    const get = async (req: Request) =>
      ((await (await publicRoute.GET(req, ctx)).json()) as { result: { crux_trial: { outcome: string } } }).result.crux_trial.outcome;
    expect(await get(new Request(`${ORIGIN}/api/v1/verdicts/${id}`))).toBe("survived");
    expect(await get(new Request(`${ORIGIN}/api/v1/verdicts/${id}`, { headers: { "Judge-Trial": "minor" } }))).toBe("minor");
  });
});
