import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GamifyButton } from "../components/shell/GamifyButton";

describe("gamify button", () => {
  it("is a toggle button, pressed by default", () => {
    const html = renderToStaticMarkup(<GamifyButton lang="en" />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain("role=");
    expect(html).not.toContain("aria-checked");
  });

  it("is an icon with its name as the label", () => {
    const html = renderToStaticMarkup(<GamifyButton lang="en" />);
    expect(html).toContain('aria-label="Gamify"');
    expect(html).not.toMatch(/<\/svg><span/);
  });
});
