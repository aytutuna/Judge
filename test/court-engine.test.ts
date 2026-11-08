import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCourt, pickSpots, seeded, type CourtScene } from "../components/court/engine";

const BEATS = ["names", "facts", "judges", "bothSides", "crux", "ruling", "vote1", "more", "vote2", "trial", "final"] as const;
const judging = (beat: (typeof BEATS)[number]): CourtScene => ({
  kind: "judging",
  beat,
  votes: ["a", "b", "other", "a", "b"],
  extra: 2,
  winner: "a",
  trial: "uncertain",
});

describe("court spots", () => {
  it("never puts two agents on top of each other", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const at = Object.values(pickSpots(seeded(seed)));
      expect(at).toHaveLength(9);
      for (const [i, p] of at.entries()) {
        for (const q of at.slice(i + 1)) {
          expect(Math.abs(p.x - q.x) >= 16 || Math.abs(p.y - q.y) >= 29).toBe(true);
        }
      }
    }
  });

  it("keeps the trial spots clear", () => {
    for (let seed = 1; seed <= 2000; seed++) {
      for (const p of Object.values(pickSpots(seeded(seed)))) {
        for (const t of [{ x: 192, y: 124 }, { x: 128, y: 124 }]) {
          expect(Math.abs(p.x - t.x) >= 16 || Math.abs(p.y - t.y) >= 29).toBe(true);
        }
      }
    }
  });
});

describe("court engine", () => {
  const frames: ((t: number) => void)[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : () => {}),
    set: (t, k, v) => ((t[k as string] = v), true),
  });
  const canvas = { getContext: () => ctx, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }) };

  beforeEach(() => {
    frames.length = 0;
    vi.stubGlobal("document", { hidden: false, createElement: () => canvas, addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("Image", class {
      naturalWidth = 16;
      width = 16;
      height = 16;
      onload: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => this.onload?.());
      }
    });
    vi.stubGlobal("requestAnimationFrame", (f: (t: number) => void) => frames.push(f));
    vi.stubGlobal("cancelAnimationFrame", () => frames.splice(0));
  });
  afterEach(() => vi.unstubAllGlobals());

  function run(n: number) {
    for (let i = 0; i < n; i++) frames.splice(0).forEach((f) => f(i * 50));
  }

  it("plays the beats in order, jumps and back without throwing", async () => {
    const court = createCourt(canvas as unknown as HTMLCanvasElement, { src: (n) => n, reduced: false });
    await Promise.resolve();
    court.set({ kind: "home", busy: false });
    run(200);
    court.set({ kind: "home", busy: true });
    run(200);
    for (const beat of BEATS) {
      court.set(judging(beat));
      run(100);
    }
    court.set(judging("names"));
    run(50);
    court.set(judging("final"));
    run(50);
    court.set({ kind: "judging", beat: "final", votes: [], extra: 0, winner: null, trial: null });
    court.setReduced(true);
    for (const beat of BEATS) court.set(judging(beat));
    court.setReduced(false);
    run(2000);
    court.dispose();
    expect(frames).toHaveLength(0);
  });

  it("calls back once the art is in", async () => {
    const onReady = vi.fn();
    createCourt(canvas as unknown as HTMLCanvasElement, { src: (n) => n, reduced: false, onReady });
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  });
});
