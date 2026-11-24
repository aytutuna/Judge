import { describe, expect, it } from "vitest";
import { isThrow, releaseVelocity, throwTarget } from "../lib/card-throw";

describe("releaseVelocity", () => {
  it("uses only the last 100 ms", () => {
    const v = releaseVelocity([
      { x: 0, y: 0, t: 0 },
      { x: 100, y: 0, t: 380 },
      { x: 120, y: 10, t: 420 },
      { x: 160, y: 30, t: 500 },
    ]);
    expect(v.vx).toBeCloseTo(0.5);
    expect(v.vy).toBeCloseTo(0.25);
  });

  it("is zero without a usable sample", () => {
    expect(releaseVelocity([])).toEqual({ vx: 0, vy: 0 });
    expect(releaseVelocity([{ x: 5, y: 5, t: 10 }])).toEqual({ vx: 0, vy: 0 });
  });
});

describe("isThrow", () => {
  it("throws on distance alone", () => {
    expect(isThrow(120, 0, 0, 0)).toBe(true);
    expect(isThrow(60, 60, 0, 0)).toBe(false);
  });

  it("throws a short drag only when it is fast", () => {
    expect(isThrow(40, 0, 1, 0)).toBe(true);
    expect(isThrow(40, 0, 0.3, 0)).toBe(false);
  });

  it("ignores a twitch however fast", () => {
    expect(isThrow(5, 0, 3, 0)).toBe(false);
  });
});

describe("throwTarget", () => {
  it("flies along the release velocity", () => {
    expect(throwTarget(10, 0, 0, -2, 1000)).toEqual({ x: 10, y: -1000 });
  });

  it("falls back to the drag direction when let go standing still", () => {
    const t = throwTarget(30, 40, 0, 0, 100);
    expect(t.x).toBeCloseTo(90);
    expect(t.y).toBeCloseTo(120);
  });
});
