import { describe, expect, it } from "vitest";
import { nextExample } from "@/lib/example-pick";
import vectors from "@/mobile/shared/fixtures/example-vectors.json";

const ids = ["a", "b", "c", "d"];
const first = () => 0;
const last = () => 0.999999;

describe("nextExample", () => {
  it("picks from the unseen ones and records the pick", () => {
    expect(nextExample(ids, [], first)).toEqual({ id: "a", seen: ["a"] });
    expect(nextExample(ids, ["a", "c"], first)).toEqual({ id: "b", seen: ["a", "c", "b"] });
    expect(nextExample(ids, ["a", "c"], last)).toEqual({ id: "d", seen: ["a", "c", "d"] });
  });

  it("shows every example once per round", () => {
    let seen: string[] = [];
    const shown: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const next = nextExample(ids, seen, Math.random);
      shown.push(next.id);
      seen = next.seen;
    }
    expect([...shown].sort()).toEqual(ids);
  });

  it("starts a new round without opening on the last one shown", () => {
    for (const random of [first, last, () => 0.5]) {
      const next = nextExample(ids, ["b", "c", "d", "a"], random);
      expect(next.id).not.toBe("a");
      expect(next.seen).toEqual([next.id]);
    }
  });

  it("ignores ids that are gone and a lone example repeats", () => {
    expect(nextExample(ids, ["gone", "a"], first)).toEqual({ id: "b", seen: ["a", "b"] });
    expect(nextExample(["x"], ["x"], first)).toEqual({ id: "x", seen: ["x"] });
  });
});

describe("golden vectors", () => {
  it("match the picker", () => {
    for (const c of vectors.cases) {
      expect(nextExample(vectors.ids, c.seen, () => c.random)).toEqual({ id: c.id, seen: c.seenAfter });
    }
  });
});
