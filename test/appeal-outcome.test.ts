import { describe, expect, it } from "vitest";
import { appealOutcome, confidenceChange } from "../lib/cases/outcome";
import type { Lean, VerdictResult } from "../lib/types";

type V = VerdictResult["verdict"];
const v = (verdict: V, lean?: Lean["party"] | null) => ({
  verdict,
  ...(lean === undefined ? {} : { lean: lean === null ? null : { party: lean, unanimous: true, reason: "r" } }),
});

describe("appealOutcome", () => {
  it("a winner flipped to the other winner is overturned", () => {
    expect(appealOutcome(v("side_a"), v("side_b"))).toBe("overturned");
    expect(appealOutcome(v("side_b"), v("side_a"))).toBe("overturned");
  });

  it("the same winner is upheld whatever the lean says", () => {
    expect(appealOutcome(v("side_a"), v("side_a"))).toBe("upheld");
    expect(appealOutcome(v("side_b", null), v("side_b", "a"))).toBe("upheld");
  });

  it("the same non-winner verdict is upheld only with the same lean", () => {
    expect(appealOutcome(v("split", "a"), v("split", "a"))).toBe("upheld");
    expect(appealOutcome(v("too_close", null), v("too_close", null))).toBe("upheld");
    expect(appealOutcome(v("too_close"), v("too_close"))).toBe("upheld");
    expect(appealOutcome(v("split", "a"), v("split", "b"))).toBe("changed");
    expect(appealOutcome(v("conditional", null), v("conditional", "b"))).toBe("changed");
  });

  it("anything else is changed", () => {
    expect(appealOutcome(v("side_a"), v("split", "a"))).toBe("changed");
    expect(appealOutcome(v("too_close", "b"), v("side_b"))).toBe("changed");
    expect(appealOutcome(v("dissolved"), v("conditional"))).toBe("changed");
  });

  it("confidence change is new minus old", () => {
    expect(confidenceChange({ confidence: 4 }, { confidence: 2 })).toBe(-2);
    expect(confidenceChange({ confidence: 2 }, { confidence: 5 })).toBe(3);
  });
});
