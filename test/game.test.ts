import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store caches its choice at module level, so each test loads a fresh one.
async function load() {
  vi.resetModules();
  return import("../lib/game");
}

function stubBrowser(stored: Record<string, string> = {}, storageThrows = false) {
  const root = { dataset: {} as Record<string, string> };
  vi.stubGlobal("document", { documentElement: root });
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

describe("game store", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("is on by default, also when storage is blocked", async () => {
    stubBrowser();
    expect((await load()).getGame()).toBe(true);
    stubBrowser({}, true);
    expect((await load()).getGame()).toBe(true);
  });

  it("reads a stored off and treats anything else as on", async () => {
    stubBrowser({ "verdict-game": "off" });
    expect((await load()).getGame()).toBe(false);
    stubBrowser({ "verdict-game": "maybe" });
    expect((await load()).getGame()).toBe(true);
  });

  it("writes the choice to storage and marks <html> only when off", async () => {
    const { root, stored } = stubBrowser();
    const { setGame, GAME_KEY } = await load();
    setGame(false);
    expect(stored[GAME_KEY]).toBe("off");
    expect(root.dataset.game).toBe("off");
    setGame(true);
    expect(stored[GAME_KEY]).toBe("on");
    expect(root.dataset.game).toBeUndefined();
  });

  it("keeps working when storage throws", async () => {
    const { root } = stubBrowser({}, true);
    const { setGame, getGame } = await load();
    expect(() => setGame(false)).not.toThrow();
    expect(root.dataset.game).toBe("off");
    expect(getGame()).toBe(false);
  });
});
