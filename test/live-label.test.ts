import { describe, expect, it } from "vitest";
import { liveLabel } from "../components/shell/history-labels";
import { t } from "../lib/i18n";

describe("liveLabel", () => {
  it("shows the most advanced state of a waiting link", () => {
    expect(liveLabel("en", undefined)).toBeNull();
    expect(liveLabel("en", [{ party: "b", state: "waiting" }])).toBeNull();
    expect(liveLabel("en", [{ party: "b", state: "answered" }, { party: "c", state: "waiting" }])).toBeNull();
    expect(liveLabel("en", [{ party: "b", state: "opened" }])).toBe(t("en", "case.side.opened"));
    expect(
      liveLabel("tr", [
        { party: "b", state: "opened" },
        { party: "c", state: "typing" },
      ]),
    ).toBe(t("tr", "case.side.typing"));
  });
});
