import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountMenu, accountEntry, initialOf } from "../components/AccountMenu";
import { AccountPanel, openConfirm, type AccountPanelProps } from "../components/account/AccountView";
import { SignInPanel, safeNext, withLang, type SignInPanelProps } from "../components/account/SignInView";
import { SiteFooter } from "../components/SiteChrome";
import type { AppConfig, AuthProviders, Entitlement, MeResponse } from "../lib/account-types";
import { t } from "../lib/i18n";
import { STRINGS } from "./strings";
import { PRICING } from "../lib/pricing";
import type { ViewerState } from "../lib/use-viewer";

const noop = () => {};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

/** Shapes exactly as GET /api/v1/me and /api/v1/config return them. */
const user = { id: "u1", email: "ada@example.org", name: "Ada", image: null };
const ent = (over: Partial<Entitlement> = {}): Entitlement => ({
  canUsePremium: false,
  blockedReason: "premium_required",
  credits: 0,
  subscription: null,
  resetsAt: null,
  ...over,
});
const sub = (willRenew: boolean, used = 12, cap = 200) => ({
  source: "app_store" as const,
  productId: "monthly",
  periodStart: "2026-10-19T12:00:00.000Z",
  periodEnd: "2026-11-18T12:00:00.000Z",
  willRenew,
  used,
  cap,
});
const ready = (me: MeResponse): ViewerState => ({ status: "ready", me, config: null });

function panel(over: Partial<AccountPanelProps>): string {
  return renderToStaticMarkup(
    <AccountPanel
      lang="en"
      viewer={ready({ user, entitlement: ent() })}
      deleting={false}
      deleted={false}
      deleteError={null}
      onSignOut={noop}
      onDelete={noop}
      {...over}
    />,
  );
}

describe("AccountPanel", () => {
  it("loading and error states", () => {
    expect(panel({ viewer: { status: "loading", me: null, config: null } })).toContain(
      t("en", "account.loading"),
    );
    expect(panel({ viewer: { status: "error", me: null, config: null } })).toContain(
      esc(t("en", "account.loadFailed")),
    );
  });

  it("signed out: a sign-in prompt that comes back here", () => {
    const html = panel({ viewer: ready({ user: null, entitlement: null }) });
    expect(html).toContain(t("en", "account.signInPrompt"));
    expect(html).toContain('href="/signin?next=%2Faccount"');
    expect(html).not.toContain("<dialog");
  });

  it("account with nothing left: email, zero credits, no monthly plan, a link to get more", () => {
    const html = panel({});
    expect(html).toContain("Signed in as ada@example.org");
    expect(html).not.toContain(">Free<");
    expect(html).toContain("<dd>0</dd>");
    expect(html).toContain(t("en", "account.getPremium"));
    expect(html).toContain(t("en", "account.subscriptionNone"));
    expect(html).toContain('href="/pricing"');
    expect(html).toContain(t("en", "account.signOut"));
  });

  it("premium account: credits and the monthly plan with its date and usage", () => {
    const html = panel({
      viewer: ready({ user, entitlement: ent({ canUsePremium: true, blockedReason: null, credits: 8, subscription: sub(true) }) }),
    });
    expect(html).toContain("<dd>8</dd>");
    expect(html).toContain("Renews on November 18");
    expect(html).toContain("12 of 200 verdicts used this month");
    const until = panel({
      lang: "tr",
      viewer: ready({ user, entitlement: ent({ canUsePremium: true, blockedReason: null, subscription: sub(false) }) }),
    });
    expect(until).toContain("18 Kasım tarihine kadar geçerli");
    expect(until).toContain("Bu ay 200 karardan 12 tanesini kullandın");
  });

  it("fair use: says when the allowance comes back", () => {
    const html = panel({
      viewer: ready({
        user,
        entitlement: ent({ blockedReason: "fair_use", subscription: sub(false, 200, 200), resetsAt: "2026-11-18T12:00:00.000Z" }),
      }),
    });
    expect(html).toContain("More on November 18.");
  });

  it("delete goes through a confirm dialog (focus: see openConfirm below)", () => {
    const html = panel({});
    expect(html).toContain("<dialog");
    const dialog = html.slice(html.indexOf("<dialog"));
    expect(dialog).toContain(esc(t("en", "account.deleteConfirm")));
    expect(dialog).toContain(t("en", "account.deleteYes"));
    // Server markup carries autofocus, but the page is rendered on the
    // client where React never writes it: focus is moved by hand instead.
    expect(dialog).not.toMatch(/autofocus/i);
    // the page-level button only opens the dialog
    expect(html.slice(0, html.indexOf("<dialog"))).not.toContain(t("en", "account.deleteYes"));
  });

  it("deleted and failed states", () => {
    expect(panel({ deleted: true })).toContain(t("en", "account.deleted"));
    expect(panel({ deleteError: "Nope" })).toMatch(/role="alert">Nope</);
  });
});

const none: AuthProviders = { apple: false, google: false, email: false, emailCode: false, dev: false };

function signin(over: Partial<SignInPanelProps>): string {
  return renderToStaticMarkup(
    <SignInPanel
      lang="en"
      providers={{ apple: true, google: true, email: true, emailCode: true, dev: false }}
      pending={false}
      error={null}
      emailOpen={false}
      email=""
      sentTo={null}
      captcha={null}
      canSendEmail={false}
      adult={true}
      onAdult={noop}
      onProvider={noop}
      onToggleEmail={noop}
      onEmail={noop}
      onSendEmail={noop}
      onDev={noop}
      {...over}
    />,
  );
}

describe("SignInPanel", () => {
  it("Apple and Google first, email behind a toggle", () => {
    const html = signin({});
    expect(html.indexOf("Continue with Apple")).toBeLessThan(html.indexOf("Continue with Google"));
    expect(html.indexOf("Continue with Google")).toBeLessThan(html.indexOf("Use email instead"));
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).toMatch(/<form[^>]*hidden=""/);
    expect(html).not.toContain(t("en", "signin.dev"));
  });

  it("unconfigured providers render disabled with a reason", () => {
    const html = signin({ providers: { ...none, google: true } });
    expect(html).toMatch(/disabled=""[^>]*>.*Continue with Apple.*Not available yet/);
    expect(html).not.toContain("Use email instead");
  });

  it("nothing configured says so; loading says it is loading", () => {
    expect(signin({ providers: none })).toContain(esc(t("en", "signin.unavailable")));
    expect(signin({ providers: null })).toContain(t("en", "signin.loading"));
  });

  it("dev login only when the server offers it", () => {
    const html = signin({ providers: { ...none, dev: true } });
    expect(html).toContain("Continue as test user");
    expect(html).toContain(esc(t("en", "signin.devNote")));
  });

  it("open email form has a labelled email field; sent state replaces it", () => {
    const html = signin({ emailOpen: true, email: "a@b.co", canSendEmail: true });
    expect(html).toMatch(/<label[^>]*for="([^"]+)-email"/);
    expect(html).toContain('type="email"');
    expect(html).toContain('autoComplete="email"');
    const sent = signin({ sentTo: "a@b.co", lang: "tr" });
    expect(sent).toContain("a@b.co adresine bir giriş bağlantısı gönderdik");
    expect(sent).not.toContain('type="email"');
  });

  it("nothing can be used until the 18+ box is ticked", () => {
    const html = signin({ adult: false, providers: { apple: true, google: true, email: true, emailCode: true, dev: true } });
    expect(html).toContain('type="checkbox"');
    expect(html).toContain(esc(t("en", "age.confirm")));
    expect(html.indexOf('type="checkbox"')).toBeLessThan(html.indexOf("Continue with Apple"));
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const b of buttons) expect(b).toContain('disabled=""');
    const ticked = signin({ adult: true });
    expect(ticked).toMatch(/<button[^>]*class="[^"]*primary[^"]*"(?![^>]*disabled)[^>]*>/);
  });

  it("consent is one short line with the terms and privacy links, in both languages", () => {
    const en = signin({});
    expect(en).toMatch(
      /<p[^>]*>An outside AI reads your arguments\. By continuing you agree to the <a [^>]*href="\/terms"[^>]*>Terms<\/a> and the <a [^>]*href="\/privacy"[^>]*>Privacy Policy<\/a>\.<\/p>/,
    );
    const tr = signin({ lang: "tr" });
    expect(tr).toMatch(
      /<p[^>]*>Tartışmalarını harici bir yapay zekâ okur\. Devam ederek <a [^>]*href="\/terms"[^>]*>Kullanım Koşulları<\/a>&#x27;nı ve <a [^>]*href="\/privacy"[^>]*>Gizlilik Politikası<\/a>&#x27;nı kabul etmiş olursun\.<\/p>/,
    );
    expect(en).not.toContain("Signing in keeps");
  });
});

describe("safeNext / withLang", () => {
  it("only keeps same-origin paths", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/pricing")).toBe("/pricing");
    expect(safeNext(["/account", "/x"])).toBe("/account");
    for (const bad of [undefined, "", "https://evil.example", "//evil.example", "/\\evil", "javascript:x", "/signin"]) {
      expect(safeNext(bad), String(bad)).toBe("/account");
    }
  });

  it("refuses values the browser would turn into another origin", () => {
    for (const bad of [
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
      "/\t/example.com/phish",
      "/ /evil.com",
      "/\u0000/evil.com",
      "/\u007f/evil.com",
      "/.//evil.com",
      "/a/..//evil.com",
      "/%2e%2e//evil.com",
      "/signin/../signin",
      "/x/../signin?next=/",
    ]) {
      expect(safeNext(bad), JSON.stringify(bad)).toBe("/account");
    }
  });

  it("returns the normalized path, keeping query and hash", () => {
    expect(safeNext("/pricing?x=1#plans")).toBe("/pricing?x=1#plans");
    expect(safeNext("/a/../pricing")).toBe("/pricing");
    expect(safeNext("/%2F/evil.com")).toBe("/%2F/evil.com");
  });

  it("adds the email language to the callback", () => {
    expect(withLang("/account", "tr")).toBe("/account?lang=tr");
    expect(withLang("/?a=1", "en")).toBe("/?a=1&lang=en");
  });
});

describe("account entry in the nav", () => {
  const cfg = (signIn: AuthProviders): AppConfig => ({ signIn, premiumEnabled: true, pricing: PRICING });

  it("shows nothing where nobody can sign in, a link where they can, a menu when signed in", () => {
    expect(accountEntry(null, null)).toBe("none");
    expect(accountEntry(cfg(none), { user: null, entitlement: null })).toBe("none");
    expect(accountEntry(cfg({ ...none, google: true }), { user: null, entitlement: null })).toBe("signin");
    expect(accountEntry(cfg(none), { user, entitlement: ent() })).toBe("menu");
  });

  it("uses the first letter for the avatar", () => {
    expect(initialOf("ada", "x@y.z")).toBe("A");
    expect(initialOf(" ", "zed@y.z")).toBe("Z");
    expect(initialOf("", "")).toBe("?");
  });

  it("server-renders nothing (no account UI before the store answers)", () => {
    expect(renderToStaticMarkup(<AccountMenu lang="en" />)).toBe("");
  });

  it("links Pricing in the footer", () => {
    const html = renderToStaticMarkup(<SiteFooter lang="tr" />);
    expect(html).toContain('href="/pricing"');
    expect(html).toContain(STRINGS.tr["footer.pricing"]);
  });
});

describe("delete confirmation focus", () => {
  it("opens the dialog, then moves focus to the safe button", () => {
    const order: string[] = [];
    openConfirm({ showModal: () => order.push("showModal") }, { focus: () => order.push("focus cancel") });
    expect(order).toEqual(["showModal", "focus cancel"]);
  });

  it("does nothing without a dialog", () => {
    const order: string[] = [];
    openConfirm(null, { focus: () => order.push("focus") });
    expect(order).toEqual([]);
  });
});
