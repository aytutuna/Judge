import { describe, expect, it } from "vitest";
import { joinSides } from "../lib/sides";

describe("joinSides", () => {
  it("returns the first side as written when the other is empty", () => {
    expect(joinSides("en", { text: " I was right. ", name: "Ada" }, { text: "  ", name: "Ben" })).toBe(" I was right. ");
  });

  it("puts a name in front of each side", () => {
    expect(joinSides("en", { text: " It is a fruit. ", name: "Ada" }, { text: "A vegetable.", name: " Ben " })).toBe(
      "Ada says: It is a fruit.\n\nBen says: A vegetable.",
    );
  });

  it("labels a side without a name", () => {
    expect(joinSides("en", { text: "It is a fruit.", name: "" }, { text: "A vegetable.", name: "" })).toBe(
      "My side: It is a fruit.\n\nTheir side: A vegetable.",
    );
  });

  it("leaves out an empty first side", () => {
    expect(joinSides("en", { text: " ", name: "Ada" }, { text: "A vegetable.", name: "Ben" })).toBe("Ben says: A vegetable.");
  });
});
