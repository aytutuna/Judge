import { afterEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../lib/lang";

describe("setLang", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mirrors the language onto <html lang>", () => {
    const root = { lang: "en" };
    vi.stubGlobal("document", { documentElement: root });
    setLang("tr");
    expect(root.lang).toBe("tr");
    setLang("en");
    expect(root.lang).toBe("en");
  });

  it("does not throw without a document", () => {
    expect(() => setLang("en")).not.toThrow();
  });
});
