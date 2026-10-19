import { describe, expect, it } from "vitest";
import { FADE_CLEAR_PX, avoidOpacity, fadeForGap, type Box } from "../lib/scene-avoid";

const box = (top: number, bottom: number, left = 0, right = 390): Box => ({ top, bottom, left, right });

describe("fadeForGap", () => {
  it("is fully opaque with enough clear space and gone with the same overlap", () => {
    expect(fadeForGap(FADE_CLEAR_PX)).toBe(1);
    expect(fadeForGap(200)).toBe(1);
    expect(fadeForGap(-FADE_CLEAR_PX)).toBe(0);
    expect(fadeForGap(-300)).toBe(0);
  });

  it("is half way when the edges touch and monotonic in between", () => {
    expect(fadeForGap(0)).toBeCloseTo(0.5);
    let prev = -1;
    for (let g = -FADE_CLEAR_PX - 4; g <= FADE_CLEAR_PX + 4; g += 1) {
      const op = fadeForGap(g);
      expect(op).toBeGreaterThanOrEqual(prev);
      prev = op;
    }
  });

  it("keeps a resting pose that clears the text by a normal margin fully opaque", () => {
    // Review cases: 26px (verdict pose at the top, 390px) and 39px (idle at
    // 320px) of clear space used to render at .545 and .816.
    expect(fadeForGap(26)).toBe(1);
    expect(fadeForGap(39)).toBe(1);
  });
});

describe("avoidOpacity", () => {
  const drawing = box(40, 320, 20, 370);

  it("is 1 with no text boxes", () => {
    expect(avoidOpacity(drawing, [])).toBe(1);
  });

  it("is 1 when the text sits well below the drawing", () => {
    expect(avoidOpacity(drawing, [box(363, 600)])).toBe(1);
  });

  it("is 0 when the text runs through the drawing (above or below)", () => {
    expect(avoidOpacity(drawing, [box(75, 300)])).toBe(0);
    expect(avoidOpacity(drawing, [box(0, 200)])).toBe(0);
  });

  it("ignores boxes in other columns and empty boxes", () => {
    expect(avoidOpacity(drawing, [box(100, 200, 380, 500)])).toBe(1);
    expect(avoidOpacity(drawing, [box(100, 100)])).toBe(1);
  });

  it("takes the most restrictive box", () => {
    expect(avoidOpacity(drawing, [box(600, 700), box(320, 400)])).toBeCloseTo(0.5);
  });
});
