import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-public-panel-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");

const { saveVerdict, getVerdict } = await import("../lib/db");
const route = await import("../app/api/v1/verdicts/[id]/route");
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
  dispute_type: "factual",
  headline: "Party B is right",
  crux: "c",
  split_points: null,
  conditional: null,
  argument_map: {
    side_a: [{ claim: "a", kind: "fact" }],
    side_b: [{ claim: "b", kind: "fact" }],
    bedrock_a: "ba",
    bedrock_b: "bb",
  },
  facts_relied_on: [],
  losing_side_best_point: "p",
  confidence: 5,
  runs: ["side_b", "side_b", "side_b"],
  demo: false,
  tier: "premium",
  fact_check: { status: "none", claims: [] },
  panel: { models: ["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
  lang: "en",
};

describe("panel models in public output", () => {
  it("the public GET never carries a model id", async () => {
    await saveVerdict({ id: "panel00001", input: "text", result: RESULT });
    const res = await route.GET(new Request("http://localhost/api/v1/verdicts/panel00001"), {
      params: Promise.resolve({ id: "panel00001" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/claude/i);
    const body = JSON.parse(text) as { result: VerdictResult };
    expect(body.result.panel?.models).toEqual(["strong", "strong", "quick"]);
  });

  it("the stored row is left as it was", async () => {
    const { getDb } = await import("../lib/db");
    const rs = await (await getDb()).execute({ sql: "SELECT result FROM verdicts WHERE id = ?", args: ["panel00001"] });
    expect(String(rs.rows[0].result)).toContain("claude-haiku-5-5");
    expect((await getVerdict("panel00001"))?.result.panel?.models).toEqual(["strong", "strong", "quick"]);
  });

  it("a translation saved from a parsed result keeps its quick seat", async () => {
    const { saveTranslation, getTranslation } = await import("../lib/db");
    const parsed = await getVerdict("panel00001");
    await saveTranslation("panel00001", "de", { ...parsed!.result, lang: "de" });
    expect((await getTranslation("panel00001", "de"))?.panel?.models).toEqual(["strong", "strong", "quick"]);
  });
});
