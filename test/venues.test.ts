import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCourt, type CourtScene } from "../components/court/engine";
import { VENUES, parseVenue, pickVenue } from "../lib/venues";
import vectors from "../mobile/shared/fixtures/venue-vectors.json";
import exported from "../mobile/android/app/src/main/assets/venues.json";

describe("pickVenue", () => {
  it("matches the golden vectors the apps check against", () => {
    expect(vectors.ids).toEqual([...VENUES]);
    for (const c of vectors.cases) expect(pickVenue(vectors.ids, c.last, () => c.random), JSON.stringify(c)).toBe(c.id);
    const s = vectors.single;
    expect(pickVenue(s.ids, s.last, () => s.random)).toBe(s.id);
  });

  it("never repeats the last one and reaches every other", () => {
    for (const last of VENUES) {
      const seen = new Set<string>();
      for (let i = 0; i < 400; i++) seen.add(pickVenue(VENUES, last, () => i / 400));
      expect(seen.has(last)).toBe(false);
      expect(seen.size).toBe(VENUES.length - 1);
    }
  });

  it("stays on the last index for a random at the top of the range", () => {
    expect(pickVenue(["a", "b", "c"], null, () => 0.9999999999999999)).toBe("c");
  });
});

describe("parseVenue", () => {
  it("accepts the listed ids and nothing else", () => {
    for (const id of VENUES) expect(parseVenue(id)).toBe(id);
    for (const bad of ["moon", "", "COURT", 3, null, undefined, ["beach"], { id: "beach" }]) expect(parseVenue(bad)).toBeNull();
  });

  it("is the list the apps are given", () => {
    expect(exported).toEqual([...VENUES]);
  });
});

describe("court scenes", () => {
  const frames: ((t: number) => void)[] = [];
  const drawn: string[] = [];
  const asked: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k === "drawImage" ? (img: { src?: string }, x: number, y: number) => drawn.push(`${img.src}@${x},${y}`) : k in t ? t[k as string] : () => {}),
    set: (t, k, v) => ((t[k as string] = v), true),
  });
  const canvas = { getContext: () => ctx, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }) };

  beforeEach(() => {
    frames.length = 0;
    drawn.length = 0;
    asked.length = 0;
    vi.stubGlobal("document", { hidden: false, createElement: () => canvas, addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("Image", class {
      naturalWidth = 16;
      width = 16;
      height = 16;
      onload: (() => void) | null = null;
      #src = "";
      get src() {
        return this.#src;
      }
      set src(v: string) {
        this.#src = v;
        asked.push(v);
        queueMicrotask(() => this.onload?.());
      }
    });
    vi.stubGlobal("requestAnimationFrame", (f: (t: number) => void) => frames.push(f));
    vi.stubGlobal("cancelAnimationFrame", () => frames.splice(0));
  });
  afterEach(() => vi.unstubAllGlobals());

  const judging = (venue?: string): CourtScene => ({ kind: "judging", venue, beat: "vote1", votes: ["a", "b", "a"], extra: 0, winner: null, trial: null });
  const run = (n: number) => {
    for (let i = 0; i < n; i++) frames.splice(0).forEach((f) => f(i * 50));
  };
  const ready = async (venue?: string) => {
    const onReady = vi.fn();
    const court = createCourt(canvas as unknown as HTMLCanvasElement, { src: (n) => n, reduced: false, onReady });
    court.set(judging(venue));
    await vi.waitFor(() => expect(onReady).toHaveBeenCalled());
    return court;
  };

  it("paints the venue's picture instead of the court's ground and props", async () => {
    const court = await ready("beach");
    expect(drawn).toContain("venues/beach@0,0");
    expect(drawn).not.toContain("ground@0,0");
    court.dispose();
  });

  it("takes the street court for a missing or unknown venue, and does not ask for a venue picture", async () => {
    for (const venue of [undefined, "court", "moon"]) {
      drawn.length = 0;
      asked.length = 0;
      const court = await ready(venue);
      expect(drawn).toContain("ground@0,0");
      expect(asked.some((a) => a.startsWith("venues/"))).toBe(false);
      court.dispose();
    }
  });

  it("changes the backdrop when the venue changes and plays the votes in each", async () => {
    const court = await ready("farm");
    run(60);
    drawn.length = 0;
    court.set(judging("tv"));
    await vi.waitFor(() => expect(drawn).toContain("venues/tv@0,0"));
    run(60);
    drawn.length = 0;
    court.set(judging("court"));
    await vi.waitFor(() => expect(drawn).toContain("ground@0,0"));
    expect(asked).not.toContain("venues/court");
    court.dispose();
  });

  it("throws the ball only on the court", async () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    for (const venue of VENUES) {
      drawn.length = 0;
      const court = await ready(venue);
      let t = 0;
      for (let i = 0; i < 60; i++) frames.splice(0).forEach((f) => f((t += 50)));
      expect(drawn.some((d) => d.startsWith("props/ball@")), venue).toBe(venue === "court");
      court.dispose();
    }
    vi.restoreAllMocks();
  });

  it("plays every venue through its beats", async () => {
    for (const venue of VENUES) {
      const court = await ready(venue);
      run(120);
      court.set({ kind: "home", busy: true, venue });
      run(40);
      court.dispose();
    }
  });
});
