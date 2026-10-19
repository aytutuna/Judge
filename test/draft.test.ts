import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_KEY, clearDraft, parseDraft, registerDraftSource, saveDraftForSignIn, takeDraft } from "../lib/draft";

/** A minimal sessionStorage for the node test environment. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
  };
}

let storage: ReturnType<typeof fakeStorage>;
let unregister: (() => void) | null = null;

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal("sessionStorage", storage);
});

afterEach(() => {
  unregister?.();
  unregister = null;
  vi.unstubAllGlobals();
});

const ARG = "Ada says tomatoes are vegetables; Ben says they are fruit.";

describe("draft round trip through sign-in", () => {
  it("saves the registered form on the way to sign-in and gives it back once", () => {
    unregister = registerDraftSource(() => ({ argument: ARG, framework: { preset: "balanced" } }));
    saveDraftForSignIn();
    expect(storage.map.has(DRAFT_KEY)).toBe(true);
    expect(takeDraft()).toEqual({ argument: ARG, framework: { preset: "balanced" } });
    expect(takeDraft()).toBeNull();
  });

  it("keeps sliders", () => {
    const framework = { preset: "custom", sliders: { harm: 80, fairness: 20 } };
    unregister = registerDraftSource(() => ({ argument: ARG, framework }));
    saveDraftForSignIn();
    expect(takeDraft()).toEqual({ argument: ARG, framework });
  });

  it("saves nothing without a form, with an empty argument, or when the form has nothing unsent", () => {
    saveDraftForSignIn();
    unregister = registerDraftSource(() => ({ argument: "   ", framework: { preset: "balanced" } }));
    saveDraftForSignIn();
    unregister();
    unregister = registerDraftSource(() => null);
    saveDraftForSignIn();
    expect(storage.map.size).toBe(0);
  });

  it("an old registration cannot unregister a newer one", () => {
    const first = registerDraftSource(() => ({ argument: "first draft text", framework: { preset: "balanced" } }));
    unregister = registerDraftSource(() => ({ argument: ARG, framework: { preset: "balanced" } }));
    first();
    saveDraftForSignIn();
    expect(takeDraft()?.argument).toBe(ARG);
  });

  it("clearDraft removes a saved draft", () => {
    unregister = registerDraftSource(() => ({ argument: ARG, framework: { preset: "balanced" } }));
    saveDraftForSignIn();
    clearDraft();
    expect(takeDraft()).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    unregister = registerDraftSource(() => ({ argument: ARG, framework: { preset: "balanced" } }));
    expect(() => saveDraftForSignIn()).not.toThrow();
    expect(takeDraft()).toBeNull();
    expect(() => clearDraft()).not.toThrow();
  });
});

describe("parseDraft", () => {
  it("rejects anything malformed (storage is user-writable)", () => {
    for (const raw of [
      "not json",
      "null",
      "[]",
      JSON.stringify({ argument: 5, framework: { preset: "balanced" } }),
      JSON.stringify({ argument: "", framework: { preset: "balanced" } }),
      JSON.stringify({ argument: "x".repeat(6001), framework: { preset: "balanced" } }),
      JSON.stringify({ argument: ARG }),
      JSON.stringify({ argument: ARG, framework: { preset: 1 } }),
      JSON.stringify({ argument: ARG, framework: { preset: "balanced", sliders: { a: 101 } } }),
      JSON.stringify({ argument: ARG, framework: { preset: "balanced", sliders: { a: "50" } } }),
      JSON.stringify({ argument: ARG, framework: { preset: "balanced", sliders: [1] } }),
    ]) {
      expect(parseDraft(raw), raw.slice(0, 60)).toBeNull();
    }
  });

  it("drops unknown keys", () => {
    const raw = JSON.stringify({ argument: ARG, framework: { preset: "balanced", extra: 1 }, other: true });
    expect(parseDraft(raw)).toEqual({ argument: ARG, framework: { preset: "balanced" } });
  });
});
