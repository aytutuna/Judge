import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import type { VerdictResult } from "../lib/types";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-db-"));
const file = path.join(dir, "test.db").replace(/\\/g, "/");
const url = `file:${file}`;

// lib/db reads DATABASE_URL when first used, so set it before importing.
process.env.DATABASE_URL = url;
const { getVerdict, saveVerdict } = await import("../lib/db");

const RESULT: VerdictResult = {
  verdict: "side_a",
  dispute_type: "factual",
  confidence: 4,
  headline: "Party A is right",
  crux: "The boiling point at altitude",
  split_points: null,
  conditional: null,
  argument_map: {
    side_a: [{ claim: "Water boils lower up high", kind: "fact" }],
    side_b: [{ claim: "Water always boils at 100C", kind: "fact" }],
    bedrock_a: "Physics",
    bedrock_b: "School memory",
  },
  facts_relied_on: ["Boiling point drops with pressure"],
  losing_side_best_point: "At sea level it is 100C",
  runs: ["side_a", "side_a", "side_a"],
  demo: false,
};

beforeAll(() => {
  // A row as the previous storage layer wrote it (no optional fields).
  const legacy = createClient({ url });
  return legacy
    .execute(`CREATE TABLE IF NOT EXISTS verdicts (
      id TEXT PRIMARY KEY,
      input TEXT NOT NULL,
      framework TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    .then(() =>
      legacy.execute({
        sql: "INSERT INTO verdicts (id, input, framework, result, created_at) VALUES (?, ?, ?, ?, ?)",
        args: ["legacy0001", "old text", '{"preset":"balanced"}', JSON.stringify(RESULT), "2026-01-01 10:00:00"],
      }),
    )
    .finally(() => legacy.close());
});

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  // Best effort: Windows can hold the file briefly after close.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

describe("db (libSQL)", () => {
  it("round-trips a saved verdict", async () => {
    await saveVerdict({
      id: "abc123defg",
      input: "Party A says...",
      framework: { preset: "balanced", sliders: { care: 70 } },
      result: { ...RESULT, lean: null },
    });
    const stored = await getVerdict("abc123defg");
    expect(stored).not.toBeNull();
    expect(stored!.input).toBe("Party A says...");
    expect(stored!.framework).toEqual({ preset: "balanced", sliders: { care: 70 } });
    expect(stored!.result).toEqual({ ...RESULT, lean: null });
    expect(stored!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("reads rows written by the previous storage layer", async () => {
    const stored = await getVerdict("legacy0001");
    expect(stored).toMatchObject({
      id: "legacy0001",
      input: "old text",
      framework: { preset: "balanced" },
      createdAt: "2026-01-01 10:00:00",
    });
    expect(stored!.result.headline).toBe("Party A is right");
  });

  it("returns null for an unknown id", async () => {
    expect(await getVerdict("nope")).toBeNull();
  });
});
