import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GamifyButton } from "../components/shell/GamifyButton";

describe("gamify switch", () => {
  it("is a switch, on by default", () => {
    const html = renderToStaticMarkup(<GamifyButton lang="en" />);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain("aria-pressed");
  });
});
