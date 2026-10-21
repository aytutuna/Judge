import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TierSwitch, tierNote, type TierSwitchProps } from "../components/TierSwitch";
import type { AppConfig, Entitlement, MeResponse } from "../lib/account-types";
import { STRINGS, t } from "../lib/i18n";
import { PRICING } from "../lib/pricing";
import { effectiveTier, premiumRemaining, signInOffered, tierAvailability } from "../lib/tier";

const config = (premiumEnabled: boolean): AppConfig => ({
  signIn: { apple: false, google: false, email: false, emailCode: false, dev: true },
  premiumEnabled,
  pricing: PRICING,
});

const ent = (over: Partial<Entitlement> = {}): Entitlement => ({
  canUsePremium: true,
  blockedReason: null,
  credits: 0,
  subscription: null,
  resetsAt: null,
  ...over,
});

const user = { id: "u1", email: "test@verdict.local", name: "Test user", image: null };
const me = (entitlement: Entitlement | null): MeResponse => ({ user, entitlement });
const signedOut: MeResponse = { user: null, entitlement: null };

const sub = (used: number, cap: number) => ({
  source: "admin" as const,
  productId: "monthly",
  periodStart: "2026-10-19T12:00:00.000Z",
  periodEnd: "2026-11-18T12:00:00.000Z",
  willRenew: false,
  used,
  cap,
});

function render(over: Partial<TierSwitchProps>): string {
  return renderToStaticMarkup(
    <TierSwitch
      lang="en"
      availability="available"
      value="free"
      onChange={() => {}}
      entitlement={null}
      {...over}
    />,
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

describe("tierAvailability", () => {
  it("hides the switch until premium is known to be on", () => {
    expect(tierAvailability(null, null)).toBe("hidden");
    expect(tierAvailability(config(false), me(ent()))).toBe("hidden");
  });

  it("locks Premium for signed-out and out-of-credit viewers", () => {
    expect(tierAvailability(config(true), null)).toBe("signed_out");
    expect(tierAvailability(config(true), signedOut)).toBe("signed_out");
    expect(tierAvailability(config(true), me(ent({ canUsePremium: false, blockedReason: "no_credits" })))).toBe(
      "locked",
    );
    expect(tierAvailability(config(true), me(null))).toBe("locked");
  });

  it("opens Premium when the account can use it", () => {
    expect(tierAvailability(config(true), me(ent({ credits: 3 })))).toBe("available");
  });

  it("hides the switch for signed-out viewers when no sign-in method is set up", () => {
    const noSignIn: AppConfig = {
      ...config(true),
      signIn: { apple: false, google: false, email: false, emailCode: false, dev: false },
    };
    expect(tierAvailability(noSignIn, signedOut)).toBe("hidden");
    expect(tierAvailability(noSignIn, null)).toBe("hidden");
    // Someone already signed in (a session from before) still sees it.
    expect(tierAvailability(noSignIn, me(ent({ credits: 3 })))).toBe("available");
    for (const k of ["apple", "google", "email", "dev"] as const) {
      expect(tierAvailability({ ...noSignIn, signIn: { ...noSignIn.signIn, [k]: true } }, signedOut), k).toBe(
        "signed_out",
      );
    }
    expect(signInOffered(noSignIn)).toBe(false);
    expect(signInOffered(null)).toBe(false);
  });
});

describe("effectiveTier", () => {
  it("never turns a remembered premium choice into a premium request unless available", () => {
    expect(effectiveTier("available", "premium")).toBe("premium");
    expect(effectiveTier("available", "free")).toBe("free");
    for (const a of ["hidden", "signed_out", "locked"] as const) {
      expect(effectiveTier(a, "premium")).toBe("free");
    }
  });
});

describe("premiumRemaining", () => {
  it("prefers the monthly allowance, then credits", () => {
    expect(premiumRemaining(ent({ credits: 4, subscription: sub(10, 200) }))).toEqual({ kind: "monthly", n: 190 });
    expect(premiumRemaining(ent({ credits: 4, subscription: sub(200, 200) }))).toEqual({ kind: "credits", n: 4 });
    expect(premiumRemaining(ent({ credits: 0 }))).toBeNull();
    expect(premiumRemaining(null)).toBeNull();
  });
});

describe("tierNote", () => {
  it("says nothing for signed-out viewers until they reach for Premium", () => {
    expect(tierNote("en", "signed_out", "free", null, false)).toBeNull();
    expect(tierNote("en", "signed_out", "free", null, true)?.link).toEqual({
      href: "/signin",
      label: "Sign in to use Premium",
    });
  });

  it("invites signed-in free users and explains why Premium is locked", () => {
    expect(tierNote("en", "locked", "free", ent({ canUsePremium: false, blockedReason: "premium_required" }), false))
      .toEqual({ text: t("en", "tier.invite"), link: { href: "/pricing", label: "Get Premium" } });
    expect(
      tierNote("tr", "locked", "free", ent({ canUsePremium: false, blockedReason: "no_credits" }), false)?.text,
    ).toBe(STRINGS.tr["tier.outOfCredits"]);
    const fair = tierNote(
      "en",
      "locked",
      "free",
      ent({ canUsePremium: false, blockedReason: "fair_use", resetsAt: "2026-11-18T12:00:00.000Z" }),
      false,
    );
    expect(fair?.text).toBe("You've used this month's premium verdicts. More on November 18.");
  });

  it("shows what is left when Premium is picked", () => {
    expect(tierNote("en", "available", "premium", ent({ credits: 1 }), false)?.text).toContain(
      "1 premium verdict left.",
    );
    expect(tierNote("en", "available", "premium", ent({ credits: 12 }), false)?.text).toContain(
      "12 premium verdicts left.",
    );
    expect(tierNote("tr", "available", "premium", ent({ subscription: sub(20, 200) }), false)?.text).toContain(
      "Bu ay 180 hakkın kaldı.",
    );
    expect(tierNote("en", "available", "free", ent({ credits: 12 }), false)?.text).toBe(t("en", "tier.freeHint"));
  });
});

describe("TierSwitch", () => {
  it("renders nothing when hidden", () => {
    expect(render({ availability: "hidden" })).toBe("");
  });

  it("is a labelled radio group of two native radios", () => {
    const html = render({});
    expect(html).toContain("<fieldset");
    expect(html).toContain(`<legend class="sr-only">${esc(t("en", "tier.label"))}</legend>`);
    expect(html.split('type="radio"').length - 1).toBe(2);
    expect(html).toMatch(/checked="" value="free"/);
    // the note is a polite live region
    expect(html).toContain('aria-live="polite"');
  });

  it("signed out: Free selected, Premium locked, no note yet", () => {
    const html = render({ availability: "signed_out" });
    expect(html).toMatch(/checked="" value="free"/);
    expect(html).not.toMatch(/checked="" value="premium"/);
    expect(html).toContain("data-locked");
    expect(html).toMatch(/<p id="[^"]+" class="sr-only" aria-live="polite"><\/p>/);
  });

  it("signed in without premium: Free selected with the invitation and a pricing link", () => {
    const html = render({
      availability: "locked",
      entitlement: ent({ canUsePremium: false, blockedReason: "premium_required" }),
    });
    expect(html).toMatch(/checked="" value="free"/);
    expect(html).toContain(esc(t("en", "tier.invite")));
    expect(html).toContain('href="/pricing"');
    expect(html).toContain("data-locked");
  });

  it("premium available: both selectable, Premium checked shows the remaining count", () => {
    const html = render({ value: "premium", entitlement: ent({ credits: 7 }) });
    expect(html).toMatch(/checked="" value="premium"/);
    expect(html).not.toContain("data-locked");
    expect(html).toContain("7 premium verdicts left.");
  });
});
