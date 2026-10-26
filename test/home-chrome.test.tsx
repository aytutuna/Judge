import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Faq, FAQ_ITEMS } from "../components/home/Faq";
import { LangToggle } from "../components/LangToggle";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";
import { HOW_STEPS, stepNumeral } from "../lib/how-steps";
import { STRINGS, t, type Lang } from "../lib/i18n";

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
  it("adds a spacer under the fixed nav and the toggle only when asked", () => {
    const html = renderToStaticMarkup(<SiteHeader lang="tr" toggle />);
    expect(count(html, 'aria-hidden="true" class=')).toBe(1);
    expect(html).toContain(`aria-label="${t("tr", "footer.language")}"`);
    expect(renderToStaticMarkup(<SiteHeader lang="en" />)).not.toContain(t("en", "footer.language"));
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
