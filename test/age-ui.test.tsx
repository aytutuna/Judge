import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgeDialogBody, type AgeDialogProps } from "../components/AgeGate";
import { PricingTable } from "../components/account/PricingView";
import { SiteFooter } from "../components/SiteChrome";
import { API_ERROR_STATUS } from "../lib/api-errors";
import { apiErrorMessage, ERROR_KEY_BY_CODE, t } from "../lib/i18n";
import { PRICING } from "../lib/pricing";
import { STRINGS } from "./strings";

const noop = () => {};
const FRESH = { confirmed: false, blocked: false, teen: false, needsDob: true };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

function dialog(over: Partial<AgeDialogProps>): string {
  return renderToStaticMarkup(
    <AgeDialogBody
      lang="en"
      age={FRESH}
      dob=""
      max="2030-01-01"
      confirming={false}
      saving={false}
      failed={false}
      contactEmail="support@okjudge.com"
      onDob={noop}
      onSubmit={noop}
      onChange={noop}
      onSignOut={noop}
      {...over}
    />,
  );
}

describe("age dialog", () => {
  it("asks for a date of birth, and only offers Continue once there is one", () => {
    const html = dialog({});
    expect(html).toContain('type="date"');
    expect(html).toContain(esc(t("en", "age.lead")));
    expect(html).not.toContain('type="checkbox"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue<\/button>/);
    expect(html).toContain(t("en", "nav.signOut"));
    expect(dialog({ dob: "2010-05-01" })).not.toMatch(/<button[^>]*disabled=""[^>]*>Continue/);
    expect(dialog({ failed: true })).toContain(esc(t("en", "age.failed")));
  });

  it("tells a blocked account Judge is for ages 13 and up, with the contact address and sign-out", () => {
    const html = dialog({ age: { ...FRESH, confirmed: true, blocked: true, needsDob: false } });
    expect(html).toContain(t("en", "age.blockedTitle"));
    expect(html).toContain("13");
    expect(html).toContain('href="mailto:support@okjudge.com"');
    expect(html).toContain(t("en", "nav.signOut"));
    expect(html).not.toContain('type="date"');
    expect(dialog({ age: { ...FRESH, blocked: true, needsDob: false }, contactEmail: null })).not.toContain("mailto:");
  });

  it("shows the date step, not the refusal, for a block from the old rule", () => {
    const html = dialog({ age: { ...FRESH, blocked: true, needsDob: true } });
    expect(html).toContain('type="date"');
    expect(html).not.toContain(esc(t("en", "age.blocked")));
  });

  it("asks for a second look at the date before it is sent", () => {
    const html = dialog({ confirming: true, dob: "2016-03-04" });
    expect(html).toContain(esc(t("en", "age.confirmDate", { date: "March 4, 2016" })));
    expect(html).toContain(t("en", "age.confirmYes"));
    expect(html).toContain(t("en", "age.change"));
    expect(html).not.toContain('type="date"');
  });

  it("speaks the reader's language", () => {
    const html = dialog({ lang: "tr", age: { ...FRESH, blocked: true, needsDob: false } });
    expect(html).toContain(STRINGS.tr["age.blockedTitle"]);
  });
});

describe("age error codes", () => {
  it("are 403s the website localizes", () => {
    expect(API_ERROR_STATUS.age_blocked).toBe(403);
    expect(API_ERROR_STATUS.age_unconfirmed).toBe(403);
    for (const code of ["age_blocked", "age_unconfirmed", "age_set", "not_for_teens"]) expect(ERROR_KEY_BY_CODE[code]).toBeDefined();
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
