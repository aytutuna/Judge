import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store caches its choice at module level, so each test loads a fresh one.
async function load() {
  vi.resetModules();
  return import("../lib/theme");
}

function stubBrowser(stored: Record<string, string> = {}, storageThrows = false) {
  const root = { dataset: {} as Record<string, string> };
  vi.stubGlobal("document", { documentElement: root, querySelectorAll: () => [] });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => {
      if (storageThrows) throw new Error("blocked");
      return stored[k] ?? null;
    },
    setItem: (k: string, v: string) => {
      if (storageThrows) throw new Error("blocked");
      stored[k] = v;
    },
  });
  return { root, stored };
}

describe("theme store", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("writes the choice to storage and to <html>", async () => {
    const { root, stored } = stubBrowser();
    const { setTheme, THEME_KEY } = await load();
    setTheme("dark");
    expect(stored[THEME_KEY]).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
    setTheme("light");
    expect(root.dataset.theme).toBe("light");
  });

  it("reads a stored choice and treats anything else as system", async () => {
    stubBrowser({ "verdict-theme": "dark" });
    expect((await load()).getTheme()).toBe("dark");
    stubBrowser({ "verdict-theme": "purple" });
    expect((await load()).getTheme()).toBe("system");
    stubBrowser({}, true);
    expect((await load()).getTheme()).toBe("system");
  });

  it("removes the attribute for system", async () => {
    const { root } = stubBrowser();
    const { setTheme } = await load();
    setTheme("dark");
    setTheme("system");
    expect(root.dataset.theme).toBeUndefined();
  });

  it("keeps working when storage throws", async () => {
    const { root } = stubBrowser({}, true);
    const { setTheme } = await load();
    expect(() => setTheme("light")).not.toThrow();
    expect(root.dataset.theme).toBe("light");
  });

  it("resolves dark from the choice, or from the system for system", async () => {
    stubBrowser();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const { resolvedDark } = await load();
    expect(resolvedDark("dark")).toBe(true);
    expect(resolvedDark("light")).toBe(false);
    expect(resolvedDark("system")).toBe(true);
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(resolvedDark("system")).toBe(false);
  });
});
