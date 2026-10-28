import { beforeEach, describe, expect, it, vi } from "vitest";
import { EN_REPLY, EN_TEXT, TR_RESULT } from "./translate-fixtures";

const m = vi.hoisted(() => ({
  getVerdict: vi.fn(),
  getTranslation: vi.fn(),
  saveTranslation: vi.fn(),
  checkTranslateLimits: vi.fn(),
  claudeJson: vi.fn(),
  verdictRemoved: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getVerdict: m.getVerdict,
  getTranslation: m.getTranslation,
  saveTranslation: m.saveTranslation,
}));
vi.mock("@/lib/ratelimit", () => ({ checkTranslateLimits: m.checkTranslateLimits }));
vi.mock("@/lib/originals/removed", () => ({ verdictRemoved: m.verdictRemoved }));
// Only the model call is mocked: the translation logic stays real.
vi.mock("@/lib/claude", () => ({ claudeJson: m.claudeJson, LITE_MODEL: "lite-model" }));

import { maxDuration, POST } from "../app/api/verdict/[id]/translate/route";
import { applyText, clearTranslationFailures } from "../lib/translate";

function post(id: string, lang: string | null) {
  const qs = lang === null ? "" : `?lang=${lang}`;
  const req = new Request(`http://localhost/api/verdict/${id}/translate${qs}`, { method: "POST" });
  return POST(req, { params: Promise.resolve({ id }) });
}

const STORED = {
  id: "abc123defg",
  input: "x",
  result: TR_RESULT,
  createdAt: "2026-10-19 10:00:00",
};

beforeEach(() => {
  vi.clearAllMocks();
  m.verdictRemoved.mockResolvedValue(false);
  clearTranslationFailures();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.getVerdict.mockResolvedValue(STORED);
  m.getTranslation.mockResolvedValue(null);
  m.saveTranslation.mockResolvedValue(undefined);
  m.checkTranslateLimits.mockResolvedValue({ ok: true });
  m.claudeJson.mockResolvedValue({ ok: true, data: EN_REPLY });
});

describe("POST /api/verdict/[id]/translate", () => {
  it("rejects a missing or unknown lang with 400", async () => {
    for (const lang of [null, "xx"]) {
      const res = await post("abc123defg", lang);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "invalid" });
    }
  });

  it("404s an unknown id, and a malformed one without a read", async () => {
    m.getVerdict.mockResolvedValue(null);
    const res = await post("nope000000", "en");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found" });

    m.getVerdict.mockClear();
    expect((await post("bad id!", "en")).status).toBe(404);
    expect(m.getVerdict).not.toHaveBeenCalled();
  });

  it("passes the original through for the content language, unmetered", async () => {
    const res = await post("abc123defg", "tr");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "abc123defg",
      lang: "tr",
      source: "tr",
      translated: false,
      result: TR_RESULT,
    });
    expect(m.checkTranslateLimits).not.toHaveBeenCalled();
    expect(m.claudeJson).not.toHaveBeenCalled();
  });

  it("serves a cached translation, unmetered", async () => {
    const cached = applyText(TR_RESULT, EN_TEXT, "en");
    m.getTranslation.mockResolvedValue(cached);
    const res = await post("abc123defg", "en");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ translated: true, source: "tr", lang: "en", result: cached });
    expect(m.checkTranslateLimits).not.toHaveBeenCalled();
    expect(m.claudeJson).not.toHaveBeenCalled();
  });

  it("translates, stores and returns a new translation", async () => {
    const res = await post("abc123defg", "en");
    expect(res.status).toBe(200);
    const expected = applyText(TR_RESULT, EN_TEXT, "en");
    expect(await res.json()).toMatchObject({ translated: true, result: expected });
    expect(m.checkTranslateLimits).toHaveBeenCalledTimes(1);
    expect(m.claudeJson).toHaveBeenCalledTimes(1);
    expect(m.claudeJson.mock.calls[0][0]).toMatchObject({ model: "lite-model", effort: "low" });
    expect(m.saveTranslation).toHaveBeenCalledWith("abc123defg", "en", expected);
  });

  it("429s a rate-limited new translation with Retry-After, before any call", async () => {
    m.checkTranslateLimits.mockResolvedValue({ ok: false, code: "rate_limited", retryAfterSec: 42 });
    const res = await post("abc123defg", "en");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(await res.json()).toMatchObject({ code: "rate_limited", retryAfterSec: 42 });
    expect(m.claudeJson).not.toHaveBeenCalled();
  });

  it("503s when the limiter itself is unavailable", async () => {
    m.checkTranslateLimits.mockResolvedValue({ ok: false, code: "unavailable", error: "redis down" });
    const res = await post("abc123defg", "en");
    expect(res.status).toBe(503);
    expect(m.claudeJson).not.toHaveBeenCalled();
  });

  it("503s a model failure and writes no cache", async () => {
    m.claudeJson.mockResolvedValue({ ok: false, blocked: false, error: "Claude HTTP 500: boom" });
    const res = await post("abc123defg", "en");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "unavailable" });
    expect(m.saveTranslation).not.toHaveBeenCalled();
  });

  it("503s a malformed model reply after one retry and writes no cache", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    m.claudeJson.mockResolvedValue({ ok: true, data: { ...EN_TEXT, side_b: [] } });
    const res = await post("abc123defg", "en");
    expect(res.status).toBe(503);
    expect(m.claudeJson).toHaveBeenCalledTimes(2);
    expect(m.claudeJson.mock.calls[1][0]).toMatchObject({ effort: "medium" });
    expect(m.saveTranslation).not.toHaveBeenCalled();
  });

  it("recovers when the retry returns a usable reply", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    m.claudeJson
      .mockResolvedValueOnce({ ok: true, data: { segments: [] } })
      .mockResolvedValueOnce({ ok: true, data: EN_REPLY });
    const res = await post("abc123defg", "en");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ translated: true, result: applyText(TR_RESULT, EN_TEXT, "en") });
    expect(m.claudeJson).toHaveBeenCalledTimes(2);
  });

  it("503s when the database read fails", async () => {
    m.getVerdict.mockRejectedValue(new Error("db down"));
    expect((await post("abc123defg", "en")).status).toBe(503);
  });

  it("allows one translation call plus headroom", () => {
    expect(maxDuration).toBeGreaterThanOrEqual(60);
    expect(maxDuration).toBeLessThanOrEqual(300);
  });
});
