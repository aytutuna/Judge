import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cast, majority, mid, run, seats } from "../components/mids/cast";

describe("mids cast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("walks, faces the way it goes and stands on arrival", async () => {
    const cast = new Cast([mid(0.8, 0.8, 1)], () => {});
    cast.w = 300;
    cast.h = 200;
    const r = run(cast, [0]);
    const arrived = r.go(0, 0.2, 0.8);
    expect(cast.mids[0]).toMatchObject({ x: 0.2, face: -1, motion: "walk", t: 2400 });
    await vi.advanceTimersByTimeAsync(2400);
    await arrived;
    expect(cast.mids[0].motion).toBe("stand");
  });

  it("a newer run on a mid quiets the older one", async () => {
    const cast = new Cast([mid(0.5, 0.8), mid(0.3, 0.8)], () => {});
    const old = run(cast, [0, 1]);
    let woke = false;
    void old.wait(500).then(() => (woke = true));
    run(cast, [1]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(woke).toBe(false);
    expect(old.alive()).toBe(false);
  });

  it("stop ends every run", async () => {
    const cast = new Cast([mid(0.5, 0.8)], () => {});
    const r = run(cast, [0]);
    cast.stop();
    expect(r.alive()).toBe(false);
  });

  it("seats spread evenly around the middle", () => {
    expect(seats(1)).toEqual([[0.5, 0.86]]);
    const three = seats(3).map(([x]) => +x.toFixed(2));
    expect(three).toEqual([0.24, 0.5, 0.76]);
    expect(seats(5)[0][0]).toBeCloseTo(0.12);
  });

  it("majority is the most common vote, or null on a tie", () => {
    expect(majority(["a", "b", "a"])).toBe("a");
    expect(majority(["a", "b"])).toBeNull();
    expect(majority(["a", "b", "b", "other"])).toBe("b");
    expect(majority([])).toBeNull();
  });
});
