import { describe, expect, it } from "vitest";
import { inviteTextOk, joinSides } from "../lib/sides";

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

describe("inviteTextOk", () => {
  it("accepts blank text without images and text of 20 or more characters", () => {
    expect(inviteTextOk("", 0)).toBe(true);
    expect(inviteTextOk("   ", 0)).toBe(true);
    expect(inviteTextOk("x".repeat(20), 2)).toBe(true);
  });

  it("refuses a few words, and images with no text", () => {
    expect(inviteTextOk("too short", 0)).toBe(false);
    expect(inviteTextOk(" ".repeat(10) + "x".repeat(19), 0)).toBe(false);
    expect(inviteTextOk("", 1)).toBe(false);
  });
});
