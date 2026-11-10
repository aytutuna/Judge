import { describe, expect, it } from "vitest";
import { SPOTS, STAND, createCourt, type CourtScene } from "../components/court/engine";
import { courtTrace } from "./court-trace";

const scene =
  (sides: number, votes: ("a" | "b" | "c" | "d" | "other")[], winner: "a" | "b" | "c" | "d" | null) =>
  (beat: Extract<CourtScene, { kind: "judging" }>["beat"]): CourtScene => ({
    kind: "judging",
    beat,
    votes,
    extra: 2,
    winner,
    trial: "uncertain",
    ...(sides > 2 ? { sides } : {}),
  });

const overlap = (p: { x: number; y: number }, q: { x: number; y: number }) =>
  Math.abs(p.x - q.x) < 16 && Math.abs(p.y - q.y) < 29;

describe("court with sides", () => {
  it("draws two sides exactly as it did before more were possible", async () => {
    // Hash of every drawing call over a whole visit, taken with the previous engine.
    const { hash } = await courtTrace(createCourt, scene(2, ["a", "b", "other", "a", "b"], "a"));
    expect(hash).toBe("8a3565017080d918c42e5fb3e319a379de609047c4f0c679bd94035a2e5f8c50");
  });

  it("plays three and four sides through every beat, with the extra sides' colours", async () => {
    const three = await courtTrace(createCourt, scene(3, ["a", "c", "c", "other", "b"], "c"));
    const four = await courtTrace(createCourt, scene(4, ["d", "c", "d", "a", "d"], "d"));
    const two = await courtTrace(createCourt, scene(2, ["a", "b", "other", "a", "b"], "a"));
    expect(two.calls).not.toContain("fillStyle=#3f7cc4");
    expect(three.calls).toContain("fillStyle=#3f7cc4");
    expect(three.calls).not.toContain("fillStyle=#8b63c4");
    expect(four.calls).toContain("fillStyle=#8b63c4");
  });

  it("keeps scouts and the other cast clear of each other", () => {
    for (const n of [2, 3, 4]) {
      const row = Object.values(STAND[n].at);
      expect(row).toHaveLength(n);
      for (const [i, p] of row.entries()) {
        for (const q of row.slice(i + 1)) expect(overlap(p, q)).toBe(false);
      }
      const spots = n > 2 ? SPOTS.many : SPOTS[2];
      for (const spot of [spots.a, spots.b, spots.atk, spots.adj]) {
        for (const p of row) expect(overlap(p, spot)).toBe(false);
      }
    }
  });

  it("tags stay readable: neighbours in the row are a tag's width apart", () => {
    for (const n of [3, 4]) {
      const xs = Object.values(STAND[n].at)
        .map((p) => p.x)
        .sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(16);
    }
  });
});
