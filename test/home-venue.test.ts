import { beforeEach, describe, expect, it, vi } from "vitest";
import { holdRequest, homeVenue, repickHomeVenue } from "../lib/home-venue";

function stubStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
}

describe("home venue", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubStorage();
  });

  it("keeps the same place until a send went through", () => {
    const first = homeVenue();
    expect(homeVenue()).toBe(first);
    expect(homeVenue()).toBe(first);
  });

  it("picks another place after a send, and keeps that one", () => {
    const first = homeVenue();
    // The pick avoids the last place this device showed.
    localStorage.setItem("judge-venue-last", first);
    const next = repickHomeVenue();
    expect(next).not.toBe(first);
    expect(homeVenue()).toBe(next);
  });
});

describe("held request", () => {
  const newKey = () => "k2";

  it("a retry of the same request keeps its key and its venue", () => {
    const held = { request: "r", key: "k1", venue: "beach" as const };
    expect(holdRequest(held, "r", "farm", newKey)).toBe(held);
  });

  it("a different request gets a new key and the venue shown on the form", () => {
    const held = { request: "r", key: "k1", venue: "beach" as const };
    expect(holdRequest(held, "other", "farm", newKey)).toEqual({ request: "other", key: "k2", venue: "farm" });
    expect(holdRequest(null, "r", "ice", newKey)).toEqual({ request: "r", key: "k2", venue: "ice" });
  });
});
