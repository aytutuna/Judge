import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeForm, type HomeFormProps } from "../components/home/HomeForm";
import { JudgingScreen } from "../components/JudgingScreen";
import { t } from "../lib/i18n";

const noop = () => {};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

function form(over: Partial<HomeFormProps> = {}): string {
  const props: HomeFormProps = {
    lang: "en",
    mine: "",
    onMine: noop,
    mineName: "",
    onMineName: noop,
    theirs: "",
    onTheirs: noop,
    theirName: "",
    onTheirName: noop,
    length: 0,
    casesOn: false,
    onExample: noop,
    canSubmit: false,
    onSubmit: noop,
    holding: false,
    error: null,
    status: null,
    ...over,
  };
  return renderToStaticMarkup(<HomeForm {...props} />);
}

describe("HomeForm", () => {
  it("blank: the example button, the solo lead, two sides and a held submit", () => {
    const html = form();
    expect(html).toContain(t("en", "home.example"));
    expect(html).toContain(t("en", "home.leadSolo"));
    expect(html.match(/<textarea/g)).toHaveLength(2);
    expect(html).toContain(esc(t("en", "home.theirPlaceholder")));
    expect(html).toMatch(new RegExp(`<button type="submit"[^>]*disabled[^>]*>${t("en", "getVerdict")}`));
    expect(html).toContain("0 / 6000");
    expect(html).not.toContain(esc(t("en", "shell.new")));
  });

  it("offers the case lead and the link only when cases are on", () => {
    const html = form({ casesOn: true, onInvite: noop });
    expect(html).toContain(t("en", "home.lead"));
    expect(html).toContain(t("en", "home.invite"));
    expect(form()).not.toContain(t("en", "home.invite"));
  });

  it("typed: the new-argument button shows and the lead goes", () => {
    const html = form({ mine: "A long enough argument about the dishes.", onNew: noop, canSubmit: true });
    expect(html).toContain(`aria-label="${t("en", "shell.new")}"`);
    expect(html).not.toContain(t("en", "home.leadSolo"));
    expect(html).not.toMatch(/<button type="submit"[^>]*disabled/);
  });

  it("flags the counter near the cap, ties the error to the first side, spins while holding", () => {
    const html = form({ length: 5800, error: "Nope", holding: true });
    expect(html).toMatch(/data-warn="" aria-hidden="true">5800 \/ 6000</);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-describedby="home-error"');
    expect(html).not.toContain(`>${t("en", "getVerdict")}<`);
    expect(html).toContain("<fieldset");
  });
});

describe("JudgingScreen", () => {
  const props = { lang: "en" as const, done: false, result: null, onFinished: noop, onCancel: noop };

  it("shows each side as submitted, falling back to the side labels", () => {
    const html = renderToStaticMarkup(
      <JudgingScreen {...props} mine={{ name: "Ada", text: "It is a fruit." }} theirs={{ name: " ", text: "A vegetable." }} />,
    );
    expect(html).toContain("Ada");
    expect(html).toContain("A vegetable.");
    expect(html).toContain(t("en", "home.theirSide"));
    expect(html).toContain(t("en", "case.cancel"));
  });

  it("has one tile for one side", () => {
    const html = renderToStaticMarkup(<JudgingScreen {...props} mine={{ name: "", text: "Only mine." }} theirs={null} />);
    expect(html).toContain(t("en", "input.labelTwoSided"));
    expect(html).not.toContain(t("en", "home.theirSide"));
  });
});
