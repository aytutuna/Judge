import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsentCard, RatingRow } from "../components/verdict/FeedbackRow";
import { t } from "../lib/i18n";

describe("RatingRow", () => {
  it("shows the prompt and both thumbs unpressed", () => {
    const html = renderToStaticMarkup(<RatingRow id="v1" lang="en" />);
    expect(html).toContain(t("en", "rating.prompt"));
    expect(html).toContain(`aria-label="${t("en", "rating.fair")}"`);
    expect(html).toContain(`aria-label="${t("en", "rating.notFair")}"`);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
  });
});

describe("ConsentCard", () => {
  it("renders nothing until the server says it was never asked", () => {
    expect(renderToStaticMarkup(<ConsentCard lang="en" />)).toBe("");
  });
});
