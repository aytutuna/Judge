import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type Client } from "@libsql/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, dbConfig, getVerdict, saveVerdict } from "../lib/db";
import { ensureSchema, LATEST_VERSION, migrate, MIGRATIONS } from "../lib/migrations";
import type { VerdictResult } from "../lib/types";

let dir: string;
const clients: Client[] = [];

function openClient(url = ":memory:"): Client {
  const client = createClient({ url });
  clients.push(client);
  return client;
}

function fixture(): VerdictResult {
  return {
    verdict: "side_a",
    dispute_type: "factual",
    confidence: 4,
    headline: "h",
    crux: "c",
    split_points: null,
    conditional: null,
    argument_map: {
      side_a: [{ claim: "a", kind: "fact" }],
      side_b: [{ claim: "b", kind: "value" }],
      bedrock_a: "ba",
      bedrock_b: "bb",
    },
    facts_relied_on: [],
    losing_side_best_point: "p",
    runs: ["side_a", "side_a", "side_b"],
    demo: false,
  };
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "verdict-db-"));
});

afterAll(() => {
  closeDb();
  for (const c of clients) c.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // On Windows libsql releases file handles only at process exit; the OS
    // temp dir cleans this up eventually.
  }
});

describe("dbConfig", () => {
  it("defaults to the local dev file", () => {
    expect(dbConfig({})).toEqual({ url: "file:./dev.db" });
  });

  it("uses DATABASE_URL when Turso is not configured", () => {
    expect(dbConfig({ DATABASE_URL: "file:/tmp/x.db" })).toEqual({ url: "file:/tmp/x.db" });
  });

  it("prefers Turso and passes the auth token", () => {
    expect(
      dbConfig({
        DATABASE_URL: "file:./dev.db",
        TURSO_DATABASE_URL: " libsql://verdict-acme.turso.io ",
        TURSO_AUTH_TOKEN: "tok",
      }),
    ).toEqual({ url: "libsql://verdict-acme.turso.io", authToken: "tok" });
  });

  it("treats empty Turso values as unset", () => {
    expect(dbConfig({ TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "" })).toEqual({
      url: "file:./dev.db",
    });
    expect(dbConfig({ TURSO_DATABASE_URL: "http://127.0.0.1:8080", TURSO_AUTH_TOKEN: "" })).toEqual({
      url: "http://127.0.0.1:8080",
      authToken: undefined,
    });
  });

  it("refuses a file database on Vercel", () => {
    expect(() => dbConfig({ VERCEL: "1" })).toThrow(/TURSO_DATABASE_URL/);
    expect(dbConfig({ VERCEL: "1", TURSO_DATABASE_URL: "libsql://x.turso.io" }).url).toBe(
      "libsql://x.turso.io",
    );
  });
});

describe("migrations", () => {
  it("have unique, increasing versions", () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions[0]).toBe(1);
    versions.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(versions[i]));
    expect(LATEST_VERSION).toBe(versions[versions.length - 1]);
  });

  it("apply once and are a no-op afterwards", async () => {
    const client = openClient();
    expect(await migrate(client)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(await migrate(client)).toEqual([]);

    const rs = await client.execute("SELECT version FROM schema_migrations ORDER BY version");
    expect(rs.rows.map((r) => Number(r.version))).toEqual(MIGRATIONS.map((m) => m.version));
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'verdicts'",
    );
    expect(tables.rows).toHaveLength(1);
  });

  it("adopt a database created before migrations existed", async () => {
    const client = openClient();
    await client.execute(`CREATE TABLE verdicts (
      id TEXT PRIMARY KEY, input TEXT NOT NULL, framework TEXT NOT NULL,
      result TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    await client.execute("INSERT INTO verdicts (id, input, framework, result) VALUES ('old', 'i', '{}', '{}')");

    await migrate(client);
    const rs = await client.execute("SELECT id FROM verdicts");
    expect(rs.rows.map((r) => r.id)).toEqual(["old"]);
  });

  it("ensureSchema migrates a fresh database and skips the write lock once current", async () => {
    const client = openClient();
    await ensureSchema(client);
    const tx = vi.spyOn(client, "transaction");
    await ensureSchema(client);
    expect(tx).not.toHaveBeenCalled();
    const rs = await client.execute("SELECT MAX(version) AS v FROM schema_migrations");
    expect(Number(rs.rows[0].v)).toBe(LATEST_VERSION);
  });
});

describe("verdict storage", () => {
  // A real file, so a second client (a cold start) can see earlier writes.
  let url: string;

  beforeAll(() => {
    url = pathToFileURL(path.join(dir, "verdicts.db")).href;
    vi.stubEnv("TURSO_DATABASE_URL", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("DATABASE_URL", url);
  });

  afterEach(() => closeDb());

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a verdict and creates the schema on first use", async () => {
    const framework = { preset: "balanced", sliders: { care: 70 } };
    await saveVerdict({ id: "abc123", input: "Party A says…", framework, result: fixture() });

    // A new client (as after a cold start) sees the same row.
    closeDb();
    const stored = await getVerdict("abc123");
    expect(stored).toMatchObject({
      id: "abc123",
      input: "Party A says…",
      framework,
      result: fixture(),
    });
    expect(stored?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("returns null for an unknown id", async () => {
    expect(await getVerdict("nope")).toBeNull();
  });

  it("returns null for a stored result that no longer matches the schema", async () => {
    const raw = openClient(url);
    await raw.execute({
      sql: "INSERT INTO verdicts (id, input, framework, result) VALUES (?, ?, ?, ?)",
      args: ["stale", "i", JSON.stringify({ preset: "balanced" }), JSON.stringify({ verdict: "maybe" })],
    });
    expect(await getVerdict("stale")).toBeNull();
  });

  it("rejects a duplicate id", async () => {
    const entry = { id: "dup", input: "i", framework: { preset: "balanced" }, result: fixture() };
    await saveVerdict(entry);
    await expect(saveVerdict(entry)).rejects.toThrow();
  });
});
