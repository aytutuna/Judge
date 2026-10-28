import { afterEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../lib/lang";

describe("setLang", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("leaves <html> alone until the strings are here", () => {
    const root = { lang: "en", dir: "ltr" };
    vi.stubGlobal("document", { documentElement: root });
    // Arabic is not enabled, so its strings never arrive.
    setLang("ar");
    expect(root).toEqual({ lang: "en", dir: "ltr" });
  });

  it("does not throw without a document", () => {
    expect(() => setLang("en")).not.toThrow();
  });
});
