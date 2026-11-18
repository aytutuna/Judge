import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flashSteps, runFlash, shortBoxes } from "../lib/flash";

describe("shortBoxes", () => {
  it("lists the boxes with fewer than 20 characters once trimmed", () => {
    const long = "a".repeat(20);
    expect(shortBoxes([long, "short", `   ${"b".repeat(19)}  `, ""])).toEqual([1, 2, 3]);
    expect(shortBoxes([long, long])).toEqual([]);
  });
});

describe("flashSteps", () => {
  it("pulses twice, 350 ms on and 200 ms off", () => {
    expect(flashSteps(false)).toEqual([
      { lit: true, ms: 350 },
      { lit: false, ms: 200 },
      { lit: true, ms: 350 },
      { lit: false, ms: 200 },
    ]);
  });

  it("is one 900 ms flash under reduced motion", () => {
    expect(flashSteps(true)).toEqual([{ lit: true, ms: 900 }, { lit: false, ms: 0 }]);
  });
});

describe("runFlash", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lights the boxes on the beat and ends dark", () => {
    const seen: boolean[] = [];
    runFlash(flashSteps(false), (lit) => seen.push(lit));
    expect(seen).toEqual([true]);
    vi.advanceTimersByTime(350);
    expect(seen).toEqual([true, false]);
    vi.advanceTimersByTime(200);
    expect(seen).toEqual([true, false, true]);
    vi.advanceTimersByTime(350 + 200);
    expect(seen).toEqual([true, false, true, false]);
    vi.advanceTimersByTime(5000);
    expect(seen).toHaveLength(4);
  });

  it("holds one 900 ms flash under reduced motion", () => {
    const seen: boolean[] = [];
    runFlash(flashSteps(true), (lit) => seen.push(lit));
    vi.advanceTimersByTime(899);
    expect(seen).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([true, false]);
  });

  it("stops and goes dark when cancelled", () => {
    const seen: boolean[] = [];
    const stop = runFlash(flashSteps(false), (lit) => seen.push(lit));
    stop();
    vi.advanceTimersByTime(2000);
    expect(seen).toEqual([true, false]);
  });
});
