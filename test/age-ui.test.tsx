import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgeDialogBody, forgetAdultTick, rememberAdultTick, type AgeDialogProps } from "../components/AgeGate";
import { PricingTable } from "../components/account/PricingView";
import { SiteFooter } from "../components/SiteChrome";
import { API_ERROR_STATUS } from "../lib/api-errors";
import { apiErrorMessage, ERROR_KEY_BY_CODE, t } from "../lib/i18n";
import { PRICING } from "../lib/pricing";
import { STRINGS } from "./strings";

const noop = () => {};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

function dialog(over: Partial<AgeDialogProps>): string {
  return renderToStaticMarkup(
    <AgeDialogBody
      lang="en"
      age={{ confirmed: false, blocked: false }}
      ticked={false}
      saving={false}
      failed={false}
      contactEmail="support@okjudge.com"
      onTick={noop}
      onConfirm={noop}
      onSignOut={noop}
      {...over}
    />,
  );
}

describe("age dialog", () => {
  it("asks an unconfirmed account to tick the box first", () => {
    const html = dialog({});
    expect(html).toContain('type="checkbox"');
    expect(html).toContain(esc(t("en", "age.confirm")));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue<\/button>/);
    expect(html).toContain(t("en", "nav.signOut"));
    expect(dialog({ ticked: true })).not.toMatch(/<button[^>]*disabled=""[^>]*>Continue/);
    expect(dialog({ failed: true })).toContain(esc(t("en", "age.failed")));
  });

  it("tells a blocked account Judge is for adults, with the contact address and sign-out", () => {
    const html = dialog({ age: { confirmed: true, blocked: true } });
    expect(html).toContain(t("en", "age.blockedTitle"));
    expect(html).toContain('href="mailto:support@okjudge.com"');
    expect(html).toContain(t("en", "nav.signOut"));
    expect(html).not.toContain('type="checkbox"');
    expect(dialog({ age: { confirmed: false, blocked: true }, contactEmail: null })).not.toContain("mailto:");
  });

  it("speaks the reader's language", () => {
    const html = dialog({ lang: "tr", age: { confirmed: false, blocked: true } });
    expect(html).toContain(STRINGS.tr["age.blockedTitle"]);
  });
});

describe("the sign-in page's tick", () => {
  it("is dropped when the sign-in fails or is given up on", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    rememberAdultTick();
    expect(store.get("judge.adultTicked")).toMatch(/^\d+$/);
    forgetAdultTick();
    expect(store.has("judge.adultTicked")).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("age error codes", () => {
  it("are 403s the website localizes", () => {
    expect(API_ERROR_STATUS.age_blocked).toBe(403);
    expect(API_ERROR_STATUS.age_unconfirmed).toBe(403);
    for (const code of ["age_blocked", "age_unconfirmed"]) expect(ERROR_KEY_BY_CODE[code]).toBeDefined();
    expect(apiErrorMessage("en", { error: "age_unconfirmed", code: "age_unconfirmed" }, 403)).toBe(
      t("en", "error.age_unconfirmed"),
    );
  });
});

describe("terms links", () => {
  it("sits next to Privacy in the footer", () => {
    const html = renderToStaticMarkup(<SiteFooter lang="en" />);
    expect(html.indexOf('href="/privacy"')).toBeLessThan(html.indexOf('href="/terms"'));
  });

  it("follows the plans on the pricing page", () => {
    const html = renderToStaticMarkup(
      <PricingTable
        lang="en"
        pricing={PRICING}
        premiumEnabled
        signedIn={false}
        signInOffered
        entitlement={null}
        features={null}
      />,
    );
    expect(html).toContain('href="/terms"');
    expect(html.lastIndexOf('href="/privacy"')).toBeGreaterThan(html.indexOf("plan-included"));
  });

  it("states the fair-use cap from the pricing config", () => {
    expect(t("en", "terms.fairUse", { cap: PRICING.monthly.fairUseCap })).toContain("up to 35 verdicts a month");
  });
});
