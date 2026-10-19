import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Faq, FAQ_ITEMS } from "../components/home/Faq";
import { EXAMPLES, Hero, MAX_ARGUMENT, type HeroProps } from "../components/home/Hero";
import { LangToggle } from "../components/LangToggle";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";
import { DEFAULT_FRAMEWORK } from "../lib/frameworks";
import { HOW_STEPS, stepNumeral } from "../lib/how-steps";
import { STRINGS, t, type Lang } from "../lib/i18n";
import { noOrphan, separatorPhrases } from "../lib/text";

const noop = () => {};

function hero(overrides: Partial<HeroProps> = {}): string {
  const props: HeroProps = {
    lang: "en",
    phase: "intake",
    argument: "",
    onArgumentChange: noop,
    onExample: noop,
    onSubmit: noop,
    canSubmit: false,
    error: null,
    framework: DEFAULT_FRAMEWORK,
    onFrameworkChange: noop,
    turnstile: <div data-testid="turnstile" />,
    judging: <div data-testid="judging" />,
    verdict: <div data-testid="verdict" />,
    ...overrides,
  };
  return renderToStaticMarkup(<Hero {...props} />);
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

// React escapes apostrophes in text; compare against the escaped form.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/</g, "&lt;");

describe("HOW_STEPS", () => {
  it("lists the five steps with keys present in both languages", () => {
    expect(HOW_STEPS).toHaveLength(5);
    for (const s of HOW_STEPS) {
      for (const lang of ["en", "tr"] as const) {
        expect(STRINGS[lang][s.title]).toBeTruthy();
        expect(STRINGS[lang][s.body]).toBeTruthy();
      }
    }
  });

  it("numbers steps as two-digit numerals", () => {
    expect(HOW_STEPS.map((_, i) => stepNumeral(i))).toEqual(["01", "02", "03", "04", "05"]);
  });
});

describe("Hero", () => {
  it.each(["en", "tr"] as const)("renders the two-line title and eyebrow in %s", (lang: Lang) => {
    const html = hero({ lang });
    expect(html).toContain(esc(noOrphan(t(lang, "hero.titleLine1"))));
    expect(html).toContain(esc(noOrphan(t(lang, "hero.titleLine2"))));
    expect(html).toContain("<em>");
    for (const phrase of separatorPhrases(t(lang, "hero.eyebrow"))) expect(html).toContain(esc(phrase));
    expect(html).toContain('id="hero-title"');
  });

  it("marks the text block for the scene overlap fade", () => {
    expect(hero()).toMatch(/data-scene-avoid=""/);
  });

  it("shows a literal, aria-hidden character count", () => {
    const html = hero({ argument: "x".repeat(42) });
    expect(html).toMatch(new RegExp(`aria-hidden="true">42 / ${MAX_ARGUMENT}<`));
  });

  it("renders every example as a button and flags the one in the box", () => {
    const html = hero({ argument: t("en", EXAMPLES[1].text) });
    expect(count(html, 'type="button" class=')).toBeGreaterThanOrEqual(EXAMPLES.length);
    for (const ex of EXAMPLES) expect(html).toContain(esc(t("en", ex.label)));
    expect(count(html, "data-on")).toBe(1);
  });

  it("shows the form and Turnstile at intake, with the CTA disabled until submittable", () => {
    const html = hero();
    expect(html).toContain('id="argument"');
    expect(html).toContain('data-testid="turnstile"');
    expect(html).not.toContain('data-testid="judging"');
    expect(html).toMatch(/type="submit"[^>]*disabled/);
    expect(hero({ canSubmit: true })).not.toMatch(/type="submit"[^>]*disabled/);
  });

  it("keeps the form mounted but inert while judging, without Turnstile", () => {
    const html = hero({ phase: "judging" });
    expect(html).toMatch(/<form[^>]*inert/);
    expect(html).toContain('data-testid="judging"');
    expect(html).not.toContain('data-testid="turnstile"');
    expect(html).toContain('data-phase="judging"');
  });

  it("replaces the card with the verdict slot", () => {
    const html = hero({ phase: "verdict" });
    expect(html).not.toContain("<form");
    expect(html).toContain('data-testid="verdict"');
    expect(html).toContain('tabindex="-1"');
  });

  it("announces errors and ties them to the textarea", () => {
    const html = hero({ error: "Slow down" });
    expect(html).toMatch(/role="alert"[^>]*>|id="hero-error"/);
    expect(html).toContain("Slow down");
    expect(html).toContain('aria-describedby="hero-error"');
  });
});

describe("Faq", () => {
  it.each(["en", "tr"] as const)("renders every question as native details in %s", (lang: Lang) => {
    const html = renderToStaticMarkup(<Faq lang={lang} />);
    expect(count(html, "<details")).toBe(FAQ_ITEMS.length);
    expect(html).toContain('id="faq"');
    expect(html).toContain('aria-labelledby="faq-title"');
    expect(html).toContain(esc(t(lang, "faq.kicker")));
    for (const item of FAQ_ITEMS) expect(html).toContain(esc(t(lang, item.q)));
  });
});

describe("SiteChrome", () => {
  it("adds a spacer under the fixed nav unless the page overlays it", () => {
    const spaced = renderToStaticMarkup(<SiteHeader lang="en" />);
    const overlay = renderToStaticMarkup(<SiteHeader lang="en" overlay />);
    expect(count(spaced, 'aria-hidden="true" class=')).toBeGreaterThan(count(overlay, 'aria-hidden="true" class='));
  });

  it("labels the primary nav and links to the story only when asked", () => {
    const html = renderToStaticMarkup(<SiteHeader lang="tr" howLink toggle />);
    expect(html).toContain(`aria-label="${t("tr", "nav.primary")}"`);
    expect(html).toContain('href="#how"');
    expect(renderToStaticMarkup(<SiteHeader lang="en" />)).not.toContain('href="#how"');
  });

  it("links home, about and privacy in the footer", () => {
    const html = renderToStaticMarkup(<SiteFooter lang="en" />);
    for (const href of ['href="/"', 'href="/about"', 'href="/privacy"']) expect(html).toContain(href);
    expect(html).toContain(`aria-label="${t("en", "footer.nav")}"`);
  });
});

describe("LangToggle", () => {
  it("is a labelled group of two pressed-state buttons", () => {
    const html = renderToStaticMarkup(<LangToggle lang="tr" label="Display language" />);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Display language"');
    expect(html).toMatch(/lang="tr" aria-pressed="true"/);
    expect(html).toMatch(/lang="en" aria-pressed="false"/);
  });
});
