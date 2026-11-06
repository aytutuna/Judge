import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cast, mid, run, seats } from "../components/mids/cast";
import { NAMES_MIN_MS, agreement, waitingAt } from "../components/mids/story";

describe("mids cast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("walks, faces the way it goes and stands on arrival", async () => {
    const cast = new Cast([mid(0.8, 0.8, 1)], () => {});
    cast.w = 300;
    cast.h = 200;
    const r = run(cast, [0]);
    const arrived = r.go(0, 0.2, 0.8);
    // 180 px at three quarters of a 54 px mid per second.
    expect(cast.mids[0]).toMatchObject({ x: 0.2, face: -1, motion: "walk", t: 4444 });
    await vi.advanceTimersByTimeAsync(4444);
    expect(cast.mids[0].motion).toBe("settle");
    await vi.advanceTimersByTimeAsync(260);
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

  it("agreement is the most common vote, with no side on a tie", () => {
    expect(agreement(["a", "b", "a"])).toEqual({ side: "a", n: 2 });
    expect(agreement(["a", "b"]).side).toBeNull();
    expect(agreement(["a", "b", "b", "other"])).toEqual({ side: null, n: 2 });
    expect(agreement(["b", "a", "a", "b", "b"])).toEqual({ side: "b", n: 3 });
    expect(agreement([])).toEqual({ side: null, n: 0 });
  });

  it("the story holds on names until the server has them out, then walks the steps", () => {
    expect(waitingAt(60000, null)).toBe(0);
    expect(waitingAt(1000, 400)).toBe(0);
    expect(waitingAt(NAMES_MIN_MS + 10, 400)).toBe(1);
    expect(waitingAt(5000, 4000)).toBe(1);
    expect(waitingAt(4000 + 9000 + 10, 4000)).toBe(2);
    expect(waitingAt(10 * 60000, 4000)).toBe(5);
  });
});
