import { describe, expect, it } from "vitest";
import { CRUX_SERIF_MAX, cruxStyle } from "../lib/crux-style";
import { STRINGS } from "../lib/i18n";

describe("cruxStyle", () => {
  it("sets short cruxes in the display serif", () => {
    expect(cruxStyle("Is a sandwich defined by its shape or by how people use the word?")).toBe(
      "serif",
    );
    expect(cruxStyle("")).toBe("serif");
  });

  it("keeps the threshold inclusive at CRUX_SERIF_MAX characters", () => {
    expect(cruxStyle("a".repeat(CRUX_SERIF_MAX))).toBe("serif");
    expect(cruxStyle("a".repeat(CRUX_SERIF_MAX + 1))).toBe("sans");
  });

  it("falls back to the body face for a long, real-world crux", () => {
    const long =
      "Whether a promise made under social pressure, with no explicit agreement about timing, " +
      "still binds the person who made it once circumstances have changed enough that keeping it " +
      "would cost them far more than either side expected when it was made.";
    expect(long.length).toBeGreaterThan(CRUX_SERIF_MAX);
    expect(cruxStyle(long)).toBe("sans");
  });

  it("ignores surrounding and repeated whitespace", () => {
    const body = "a".repeat(CRUX_SERIF_MAX - 1);
    expect(cruxStyle(`   ${body}   `)).toBe("serif");
    expect(cruxStyle(`${"a ".repeat(60)}\n\n\n${"b  ".repeat(29)}`)).toBe("serif");
  });

  it("counts code points, not UTF-16 units", () => {
    // 100 astral characters are 200 UTF-16 units but 100 code points.
    expect(cruxStyle("𝒜".repeat(100))).toBe("serif");
  });

  it("keeps both sample cruxes in the serif", () => {
    expect(cruxStyle(STRINGS.en["sample.crux"])).toBe("serif");
    expect(cruxStyle(STRINGS.tr["sample.crux"])).toBe("serif");
  });
});
