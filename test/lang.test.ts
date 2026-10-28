import { afterEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../lib/lang";

describe("setLang", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mirrors the language and its direction onto <html>", () => {
    const root = { lang: "en", dir: "ltr" };
    vi.stubGlobal("document", { documentElement: root });
    setLang("tr");
    expect(root).toEqual({ lang: "tr", dir: "ltr" });
    setLang("ar");
    expect(root).toEqual({ lang: "ar", dir: "rtl" });
    setLang("en");
    expect(root).toEqual({ lang: "en", dir: "ltr" });
  });

  it("does not throw without a document", () => {
    expect(() => setLang("en")).not.toThrow();
  });
});
