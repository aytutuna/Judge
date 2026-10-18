import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiJson, hasApiKey } from "../lib/gemini";
import { GEMINI_HOST } from "./setup";

describe("test environment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has no Gemini API key", () => {
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    expect(hasApiKey()).toBe(false);
  });

  it("rejects requests to the Gemini host", async () => {
    await expect(
      fetch(`https://${GEMINI_HOST}/v1beta/models/x:generateContent`, { method: "POST" }),
    ).rejects.toThrow(/blocked in tests/);
  });

  it("geminiJson fails without a key and never fetches", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const res = await geminiJson({ system: "s", user: "u", schema: {} });
    expect(res).toEqual({ ok: false, blocked: false, error: "GEMINI_API_KEY not set" });
    expect(spy).not.toHaveBeenCalled();
  });
});
