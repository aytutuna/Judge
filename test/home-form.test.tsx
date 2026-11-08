import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EvidenceController } from "../components/case/EvidencePicker";
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
    theirsOpen: false,
    onAddTheirs: noop,
    onRemoveTheirs: noop,
    length: 0,
    blank: true,
    onClear: noop,
    onExample: noop,
    canSubmit: false,
    onSubmit: noop,
    canInvite: false,
    holding: false,
    error: null,
    status: null,
    ...over,
  };
  return renderToStaticMarkup(<HomeForm {...props} />);
}

const evidence: EvidenceController = {
  items: [],
  tokens: [],
  busy: false,
  full: false,
  failure: null,
  overLimit: false,
  add: noop,
  remove: noop,
  clear: noop,
};

describe("HomeForm", () => {
  it("blank: no title, one composer with a held send button, the example and the add-their-side chip", () => {
    const html = form();
    expect(html).not.toContain(">Judge<");
    expect(html).toContain(t("en", "home.example"));
    expect(html).toContain(t("en", "home.addTheirSide"));
    expect(html.match(/<textarea/g)).toHaveLength(1);
    expect(html).toContain(esc(t("en", "home.yourPlaceholder")));
    expect(html).toMatch(new RegExp(`<button type="submit"[^>]*disabled[^>]*aria-label="${t("en", "getVerdict")}"`));
    expect(html).toContain("0 / 6,000");
    expect(html).not.toContain(t("en", "home.clear"));
    expect(html).not.toContain(t("en", "home.addContext"));
    expect(html).not.toContain(t("en", "home.leadSolo"));
  });

  it("offers the link chip only when there is a handler, and greys it out when it cannot be used", () => {
    expect(form()).not.toContain(t("en", "home.sendLink"));
    expect(form({ onInvite: noop, canInvite: true })).toMatch(
      new RegExp(`<button type="button" class="[^"]*">(<svg.*?</svg>)${t("en", "home.sendLink")}`),
    );
    expect(form({ onInvite: noop })).toMatch(
      new RegExp(`<button type="button" class="[^"]*" disabled="">(<svg.*?</svg>)${t("en", "home.sendLink")}`),
    );
  });

  it("typed: the name goes, Clear shows and the send button is live", () => {
    const html = form({ mine: "A long enough argument about the dishes.", blank: false, canSubmit: true });
    expect(html).not.toContain(">Judge<");
    expect(html).toContain(t("en", "home.clear"));
    expect(html).not.toContain(t("en", "home.example"));
    expect(html).not.toMatch(/<button type="submit"[^>]*disabled/);
  });

  it("their side open: yours moves up as a card, theirs takes the composer and can be removed", () => {
    const html = form({ theirsOpen: true, blank: false, mine: "Mine", theirs: "Theirs" });
    expect(html.match(/<textarea/g)).toHaveLength(2);
    expect(html.indexOf('id="argument"')).toBeLessThan(html.indexOf('id="other-side"'));
    expect(html).toContain(esc(t("en", "home.theirPlaceholder")));
    expect(html).toContain(`aria-label="${t("en", "home.removeTheirSide")}"`);
    expect(html).not.toContain(t("en", "home.addTheirSide"));
    expect(html.match(/ \/ 6,000/g)).toHaveLength(1);
    expect(html.match(/type="submit"/g)).toHaveLength(1);
  });

  it("context: the add control sits in the composer, the rows and notes above it", () => {
    const html = form({
      evidence: {
        ...evidence,
        items: [{ id: "a", n: 1, name: "chat.png", thumb: null, status: "ok", token: "t", preview: null }],
        overLimit: true,
      },
    });
    expect(html).toContain(t("en", "home.addContext"));
    expect(html).toContain('aria-label="Remove image 1"');
    expect(html).toContain(esc(t("en", "evidence.limit")));
    expect(html).not.toContain(t("en", "evidence.hint", { n: 3 }));
  });

  it("context: signed out the control is the same as signed in", () => {
    const signedOut = form({ evidence, onAddContextSignIn: noop });
    expect(signedOut).toContain(t("en", "home.addContext"));
    expect(signedOut.match(/<button[^>]*>/g)).toEqual(form({ evidence }).match(/<button[^>]*>/g));
  });

  it("context: signed out shows no evidence rows or notes", () => {
    const withItem = {
      ...evidence,
      items: [{ id: "a", n: 1, name: "chat.png", thumb: null, status: "ok" as const, token: "t", preview: null }],
      overLimit: true,
    };
    const html = form({ evidence: withItem, onAddContextSignIn: noop });
    expect(html).toContain(t("en", "home.addContext"));
    expect(html).not.toContain('aria-label="Remove image 1"');
    expect(html).not.toContain(esc(t("en", "evidence.limit")));
  });

  it("context: absent when the deployment does not offer it", () => {
    expect(form({ onAddContextSignIn: noop })).not.toContain(t("en", "home.addContext"));
  });

  it("flags the counter near the cap, ties the error to the first side, spins while holding", () => {
    const html = form({ length: 5800, error: "Nope", holding: true });
    expect(html).toMatch(/data-warn="" aria-hidden="true">5,800 \/ 6,000</);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-describedby="home-error"');
    expect(html).toMatch(/data-busy=""/);
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
