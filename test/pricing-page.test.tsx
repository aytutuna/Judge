import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PricingTable, PricingView, type PricingTableProps } from "../components/account/PricingView";
import type { PricingInfo } from "../lib/account-types";
import { t } from "../lib/i18n";
import { PRICING, formatPrice } from "../lib/pricing";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");
const count = (s: string, needle: string) => s.split(needle).length - 1;

/** As GET /api/v1/config returns it. */
const pricing: PricingInfo = JSON.parse(JSON.stringify(PRICING));

function render(over: Partial<PricingTableProps> = {}): string {
  return renderToStaticMarkup(
    <PricingTable lang="en" pricing={pricing} premiumEnabled signedIn={false} signInOffered {...over} />,
  );
}

describe("PricingTable", () => {
  it("leads with the free first verdict and has no Free plan", () => {
    const html = renderToStaticMarkup(<PricingView />);
    expect(html).toContain("Your first verdict is");
    expect(html).toContain("Create an account and your first verdict is free");
    expect(t("en", "pricing.title")).toBe("Your first verdict is on us.");
    expect(t("tr", "pricing.title")).toBe("İlk kararın bizden.");
    expect(render()).not.toContain('id="plan-free"');
  });

  it("lists what every verdict gets, every pack and the monthly plan", () => {
    const html = render();
    expect(html).toContain('id="plan-included"');
    expect(html).toContain('id="plan-buy"');
    for (const p of pricing.packs) {
      expect(html).toContain(p.credits === 1 ? "1 verdict" : `${p.credits} verdicts`);
      expect(html).toContain(formatPrice(p.priceUsd, "en"));
      expect(html).toContain(`${formatPrice(p.priceUsd / p.credits, "en")} per verdict`);
    }
    expect(html).toContain(`${pricing.monthly.fairUseCap} verdicts a month`);
    expect(html).toContain("Renews every month");
    expect(html).toContain(formatPrice(pricing.monthly.priceUsd, "en"));
  });

  it("the monthly card names the offer and shows its price once", () => {
    const html = render();
    const monthly = html.slice(html.indexOf(t("en", "pricing.monthly.title")));
    const card = monthly.slice(0, monthly.indexOf("</li>"));
    expect(count(card, formatPrice(pricing.monthly.priceUsd, "en"))).toBe(1);
  });

  it("buy buttons are disabled and say Coming soon while purchases are off", () => {
    const html = render();
    const offers = pricing.packs.length + 1;
    expect(count(html, ">Coming soon<")).toBe(offers);
    expect(count(html, "disabled=\"\">Coming soon<")).toBe(offers);
  });

  it("formats prices the Turkish way in Turkish", () => {
    const html = render({ lang: "tr" });
    expect(html).toContain(formatPrice(7.5, "tr"));
    expect(html).toContain("Yakında");
    expect(html).toContain(`Ayda ${pricing.monthly.fairUseCap} karar`);
  });

  it("signed out with premium on: a sign-in call to action back to pricing", () => {
    expect(render()).toContain('href="/signin?next=%2Fpricing"');
    expect(render()).toContain(t("en", "pricing.signIn"));
    expect(render({ signedIn: true })).not.toContain("/signin");
  });

  it("no sign-in method set up: no sign-in call to action (it would be a dead end)", () => {
    const html = render({ signInOffered: false });
    expect(html).not.toContain("/signin");
    expect(html).toContain(">Coming soon<");
  });

  it("premium off: still a preview, but no sign-in call to action", () => {
    const html = render({ premiumEnabled: false });
    expect(html).toContain(esc(t("en", "pricing.preview")));
    expect(html).not.toContain("/signin");
    expect(html).toContain(">Coming soon<");
  });

  it("while config is loading: neither the preview notice nor the sign-in link", () => {
    const html = render({ premiumEnabled: null });
    expect(html).not.toContain(esc(t("en", "pricing.preview")));
    expect(html).not.toContain("/signin");
  });
});
