import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeJsonResult } from "../lib/claude";
import { EN_REPLY, EN_TEXT, TR_RESULT } from "./translate-fixtures";

const dir = mkdtempSync(path.join(tmpdir(), "verdict-translate-"));
const file = path.join(dir, "test.db").replace(/\\/g, "/");

// lib/db reads DATABASE_URL when first used, so set it before importing.
process.env.DATABASE_URL = `file:${file}`;
const { getTranslation, saveTranslation, saveVerdict } = await import("../lib/db");
const {
  applyText,
  clearTranslationFailures,
  FAILURE_COOLDOWN_MS,
  MAX_FAILURE_COOLDOWN_MS,
  pendingTranslations,
  translatedVerdict,
} = await import("../lib/translate");

const open = async () => null;

let seq = 0;
async function newVerdict(result = TR_RESULT): Promise<string> {
  const id = `tr${String(++seq).padStart(8, "0")}`;
  await saveVerdict({ id, input: "Taraf A ... Taraf B ...", framework: { preset: "balanced" }, result });
  return id;
}

/** A model call that resolves only when released, to hold requests in flight. */
function heldCall(reply: ClaudeJsonResult<unknown>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const call = vi.fn(async () => {
    await gate;
    return reply;
  });
  return { call, release };
}

const OK: ClaudeJsonResult<unknown> = { ok: true, data: EN_REPLY };

beforeAll(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
  vi.clearAllMocks();
  clearTranslationFailures();
});

afterAll(() => {
  const g = globalThis as unknown as { __verdictLibsql?: { close(): void } };
  g.__verdictLibsql?.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the OS temp cleaner.
  }
});

describe("translatedVerdict", () => {
  it("is not_found for an unknown id, without gating or calling", async () => {
    const gate = vi.fn(open);
    const call = vi.fn();
    expect(await translatedVerdict("missing123", "en", gate, { call })).toEqual({ status: "not_found" });
    expect(gate).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("returns the original for the content language, for free", async () => {
    const id = await newVerdict();
    const gate = vi.fn(open);
    const call = vi.fn();
    const out = await translatedVerdict(id, "tr", gate, { call });
    expect(out).toEqual({ status: "ok", result: TR_RESULT, source: "tr", translated: false });
    expect(gate).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("miss: gates, translates once, stores; hit: serves the copy for free", async () => {
    const id = await newVerdict();
    const gate = vi.fn(open);
    const call = vi.fn().mockResolvedValue(OK);
    const first = await translatedVerdict(id, "en", gate, { call });
    const expected = applyText(TR_RESULT, EN_TEXT, "en");
    expect(first).toEqual({ status: "ok", result: expected, source: "tr", translated: true });
    expect(gate).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(1);
    expect(await getTranslation(id, "en")).toEqual(expected);

    const second = await translatedVerdict(id, "en", gate, { call });
    expect(second).toEqual(first);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("joins concurrent requests for the same pair into one model call", async () => {
    const id = await newVerdict();
    const { call, release } = heldCall(OK);
    const gate = vi.fn(open);
    const requests = Array.from({ length: 5 }, () => translatedVerdict(id, "en", gate, { call }));
    // Let every request get past its reads and into the pending job.
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    expect(pendingTranslations()).toBe(1);
    release();
    const outs = await Promise.all(requests);
    expect(call).toHaveBeenCalledTimes(1);
    for (const out of outs) expect(out).toMatchObject({ status: "ok", translated: true });
    expect(pendingTranslations()).toBe(0);
  });

  it("a request arriving while a job runs joins it without being gated", async () => {
    const id = await newVerdict();
    const { call, release } = heldCall(OK);
    const first = translatedVerdict(id, "en", vi.fn(open), { call });
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    const lateGate = vi.fn(async () => "limited");
    const late = translatedVerdict(id, "en", lateGate, { call });
    release();
    expect(await late).toMatchObject({ status: "ok", translated: true });
    expect(lateGate).not.toHaveBeenCalled();
    await first;
  });

  it("a refused gate stops a new translation and spends nothing", async () => {
    const id = await newVerdict();
    const call = vi.fn();
    const out = await translatedVerdict(id, "en", async () => "limited", { call });
    expect(out).toEqual({ status: "gated", reason: "limited" });
    expect(call).not.toHaveBeenCalled();
    expect(await getTranslation(id, "en")).toBeNull();
  });

  it("a model failure writes nothing, and a request after the cooldown can try again", async () => {
    const id = await newVerdict();
    const t0 = 1_000_000;
    const failing = vi.fn().mockResolvedValue({ ok: false, blocked: false, error: "Claude HTTP 529" });
    expect(await translatedVerdict(id, "en", open, { call: failing, now: () => t0 })).toEqual({ status: "failed" });
    expect(await getTranslation(id, "en")).toBeNull();
    expect(pendingTranslations()).toBe(0);

    const working = vi.fn().mockResolvedValue(OK);
    const later = () => t0 + FAILURE_COOLDOWN_MS;
    expect(await translatedVerdict(id, "en", open, { call: working, now: later })).toMatchObject({ status: "ok" });
  });

  it("a pair cooling down after a failure costs no call and no gate, and the cooldown grows", async () => {
    const id = await newVerdict();
    let now = 5_000_000;
    const clock = () => now;
    const gate = vi.fn(open);
    const failing = vi.fn().mockResolvedValue({ ok: false, blocked: false, error: "bad shape" });

    expect(await translatedVerdict(id, "en", gate, { call: failing, now: clock })).toEqual({ status: "failed" });
    expect(failing).toHaveBeenCalledTimes(1);

    // Many viewers inside the first cooldown: no model call, no gate.
    now += FAILURE_COOLDOWN_MS - 1;
    for (let i = 0; i < 5; i++) {
      expect(await translatedVerdict(id, "en", gate, { call: failing, now: clock })).toEqual({ status: "failed" });
    }
    expect(failing).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledTimes(1);

    // After it, one retry; failing again doubles the wait.
    now += 1;
    await translatedVerdict(id, "en", gate, { call: failing, now: clock });
    expect(failing).toHaveBeenCalledTimes(2);
    now += FAILURE_COOLDOWN_MS;
    await translatedVerdict(id, "en", gate, { call: failing, now: clock });
    expect(failing).toHaveBeenCalledTimes(2);
    now += FAILURE_COOLDOWN_MS;
    await translatedVerdict(id, "en", gate, { call: failing, now: clock });
    expect(failing).toHaveBeenCalledTimes(3);

    // A success clears the record.
    now += MAX_FAILURE_COOLDOWN_MS;
    const working = vi.fn().mockResolvedValue(OK);
    expect(await translatedVerdict(id, "en", gate, { call: working, now: clock })).toMatchObject({ status: "ok" });
  });

  it("a cooldown on one pair does not block another verdict", async () => {
    const failed = await newVerdict();
    const other = await newVerdict();
    const failing = vi.fn().mockResolvedValue({ ok: false, blocked: false, error: "boom" });
    await translatedVerdict(failed, "en", open, { call: failing });
    const working = vi.fn().mockResolvedValue(OK);
    expect(await translatedVerdict(other, "en", open, { call: working })).toMatchObject({ status: "ok" });
  });

  it("the first stored translation wins (primary key backstop)", async () => {
    const id = await newVerdict();
    const a = applyText(TR_RESULT, EN_TEXT, "en");
    const b = applyText(TR_RESULT, { ...EN_TEXT, headline: "Another wording" }, "en");
    await saveTranslation(id, "en", a);
    await saveTranslation(id, "en", b);
    expect(await getTranslation(id, "en")).toEqual(a);
  });

  it("translates a legacy row (no recorded language) by its text", async () => {
    const { lang: _lang, ...legacy } = TR_RESULT;
    void _lang;
    const id = await newVerdict(legacy);
    const call = vi.fn().mockResolvedValue(OK);
    expect(await translatedVerdict(id, "tr", open, { call })).toMatchObject({ translated: false });
    expect(await translatedVerdict(id, "en", open, { call })).toMatchObject({ translated: true, source: "tr" });
    expect(call).toHaveBeenCalledTimes(1);
  });
});
