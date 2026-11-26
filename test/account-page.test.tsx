import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountMenu, accountEntry, initialOf } from "../components/AccountMenu";
import { AccountDetailPanel, AccountPanel, openConfirm, type AccountDetailProps } from "../components/account/AccountView";
import { SignInPanel, digitsOnly, safeNext, type SignInPanelProps } from "../components/account/SignInView";
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

function panel(over: { lang?: "en" | "tr"; viewer?: ViewerState }): string {
  return renderToStaticMarkup(
    <AccountPanel lang={over.lang ?? "en"} viewer={over.viewer ?? ready({ user, entitlement: ent() })} />,
  );
}

function detail(over: Partial<AccountDetailProps>): string {
  return renderToStaticMarkup(
    <AccountDetailPanel
      lang="en"
      viewer={ready({ user, entitlement: ent() })}
      deleting={false}
      deleted={false}
      deleteError={null}
      onDelete={noop}
      {...over}
    />,
  );
}

describe("AccountDetailPanel export", () => {
  it("offers Download my data only when the page wires it", () => {
    expect(detail({})).not.toContain(esc(t("en", "account.export")));
    const html = detail({ onExport: noop });
    expect(html).toContain(esc(t("en", "account.export")));
    expect(detail({ onExport: noop, exporting: true })).toContain(esc(t("en", "account.exportBusy")));
    expect(detail({ onExport: noop, exportError: true })).toContain(esc(t("en", "account.exportFailed")));
  });
});

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
    expect(html).toContain(t("en", "nav.signIn"));
    expect(html).toContain('href="/signin?next=%2Fsettings"');
    expect(html).not.toContain("<dialog");
    expect(detail({ viewer: ready({ user: null, entitlement: null }) })).toContain(
      'href="/signin?next=%2Fsettings%2Faccount"',
    );
  });

  it("account with nothing left: email, zero credits, no monthly plan, a link to get more", () => {
    const html = panel({});
    expect(html).toContain("Signed in as ada@example.org");
    expect(html).not.toContain(">Free<");
    expect(html).toContain("<dd>0</dd>");
    expect(html).toContain(t("en", "account.getPremium"));
    expect(html).toContain(t("en", "account.subscriptionNone"));
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/settings/account"');
    expect(html).not.toContain(t("en", "account.signOut"));
    expect(html).not.toContain(t("en", "account.delete"));
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

  it("has no Password row: a password is chosen while signing in", () => {
    const viewer: ViewerState = {
      status: "ready",
      me: { user, entitlement: ent(), hasPassword: false, needsPassword: true },
      config: {
        signIn: { apple: true, google: true, email: true, emailCode: true, password: true, dev: false },
        premiumEnabled: true,
        pricing: PRICING,
      },
    };
    expect(panel({ viewer })).not.toContain("assword");
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
    const html = detail({});
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
    expect(detail({ deleted: true })).toContain(t("en", "account.deleted"));
    expect(detail({ deleteError: "Nope" })).toMatch(/role="alert">Nope</);
  });
});

const none: AuthProviders = { apple: false, google: false, email: false, emailCode: false, password: false, dev: false };

function signin(over: Partial<SignInPanelProps>): string {
  return renderToStaticMarkup(
    <SignInPanel
      lang="en"
      providers={{ apple: true, google: true, email: true, emailCode: true, password: false, dev: false }}
      pending={false}
      error={null}
      email=""
      emailStep={false}
      sentTo={null}
      code=""
      captcha={null}
      canSendEmail={false}
      hasToken
      waiting={false}
      mode="password"
      password=""
      showPassword={false}
      choosing={false}
      errorInForm={false}
      resendIn={0}
      lastUsed={null}
      onPassword={noop}
      onShowPassword={noop}
      onSignInPassword={noop}
      onSavePassword={noop}
      onSkip={noop}
      onProvider={noop}
      onEmail={noop}
      onContinue={noop}
      onSendEmail={noop}
      onForgot={noop}
      onUseCode={noop}
      onCode={noop}
      onVerify={noop}
      onResend={noop}
      onChangeEmail={noop}
      onDev={noop}
      {...over}
    />,
  );
}

describe("SignInPanel", () => {
  it("says a check is still pending while a code waits for its token", () => {
    const html = signin({ email: "a@b.co", canSendEmail: true, waiting: true });
    expect(html).toContain(esc(t("en", "turnstile.label")));
    expect(signin({ email: "a@b.co", canSendEmail: true })).not.toContain(esc(t("en", "turnstile.label")));
  });

  it("the first screen's Continue does not wait for a token when the caller allows it", () => {
    const html = signin({ email: "a@b.co", canSendEmail: true, hasToken: false });
    const button = /<button[^>]*>(?=Continue<)/.exec(html)?.[0] ?? "";
    expect(button).not.toContain('disabled=""');
  });

  it("a resend needs the token", () => {
    const code = { sentTo: "a@b.co", providers: { apple: true, google: true, email: true, emailCode: true, password: true, dev: false } };
    const resend = (hasToken: boolean) =>
      (signin({ ...code, hasToken }).match(/<button[^>]*>(?=Send a new code)/g) ?? []).join("");
    expect(resend(false)).toContain('disabled=""');
    expect(resend(true)).not.toContain('disabled=""');
  });

  it("Apple, Google, an or divider, then the email field and Continue, all usable at once", () => {
    const html = signin({ email: "a@b.co", canSendEmail: true });
    const order = ["Continue with Apple", "Continue with Google", ">or<", esc(t("en", "signin.emailLabel")), ">Continue<"].map((s) =>
      html.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(html).not.toContain('type="checkbox"');
    for (const b of html.match(/<button[^>]*>/g) ?? []) expect(b).not.toContain('disabled=""');
    expect(html).not.toContain(t("en", "signin.dev"));
  });

  it("the email field takes the address for autofill and a keyboard for email", () => {
    const html = signin({ email: "a@b.co" });
    expect(html).toMatch(/<label[^>]*for="([^"]+)-email"/);
    expect(html).toContain('type="email"');
    expect(html).toContain('inputMode="email"');
    expect(html).toContain('autoComplete="username"');
  });

  it("unconfigured providers render disabled with a reason", () => {
    const html = signin({ providers: { ...none, google: true } });
    expect(html).toMatch(/disabled=""[^>]*>.*Continue with Apple.*Not available yet/);
    expect(html).not.toContain('type="email"');
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

  it("marks the method used last", () => {
    expect(signin({})).not.toContain(esc(t("en", "signin.lastUsed")));
    for (const method of ["apple", "google", "email"] as const) {
      const html = signin({ lastUsed: method });
      expect(html.match(new RegExp(esc(t("en", "signin.lastUsed")), "g")), method).toHaveLength(1);
    }
    const apple = signin({ lastUsed: "apple" });
    expect(apple.indexOf("Last used")).toBeLessThan(apple.indexOf("Continue with Google"));
    const email = signin({ lastUsed: "email" });
    expect(email.indexOf("Last used")).toBeGreaterThan(email.indexOf("Continue with Google"));
  });

  it("a provider that is not offered carries no tag", () => {
    expect(signin({ lastUsed: "apple", providers: { ...none, google: true } })).not.toContain("Last used");
  });

  it("the code step: numeric one-time-code field, sign in, resend, change email", () => {
    const html = signin({ sentTo: "a@b.co", code: "12" });
    expect(html).toContain("We emailed a code to a@b.co");
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('value="12"');
    expect(html).not.toContain('type="email"');
    expect(html).toContain(esc(t("en", "signin.codeLabel")));
    expect(html).toContain(esc(t("en", "signin.codeResend")));
    expect(html).toContain(esc(t("en", "signin.changeEmail")));
    expect(html).not.toContain("Continue with Apple");
    // Six digits are needed before Sign in lights up.
    const submit = (h: string) => /<button[^>]*type="submit"[^>]*>/.exec(h.slice(h.indexOf("one-time-code")))![0];
    expect(submit(html)).toContain('disabled=""');
    expect(submit(signin({ sentTo: "a@b.co", code: "123456" }))).not.toContain('disabled=""');
    expect(submit(signin({ sentTo: "a@b.co", code: "123456", pending: true }))).toContain('disabled=""');
  });

  it("resend is off with a countdown, on when it reaches zero", () => {
    const waiting = signin({ sentTo: "a@b.co", resendIn: 27 });
    const label = "Resend in 27s";
    expect(new RegExp(`<button[^>]*>${label}`).exec(waiting)![0]).toContain('disabled=""');
    expect(waiting).not.toContain(esc(t("en", "signin.codeResend")));
    const ready = signin({ sentTo: "a@b.co", resendIn: 0 });
    expect(new RegExp(`<button[^>]*>${esc(t("en", "signin.codeResend"))}`).exec(ready)![0]).not.toContain('disabled=""');
  });

  it("the wrong-code error sits in the code step, linked to the field", () => {
    const html = signin({ sentTo: "a@b.co", code: "123456", error: "That code is not right" });
    const alerts = html.match(/role="alert"/g) ?? [];
    expect(alerts).toHaveLength(1);
    expect(html.indexOf("That code is not right")).toBeGreaterThan(html.indexOf("one-time-code"));
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/aria-describedby="([^"]+)-sent \1-error"/);
    const quiet = signin({ sentTo: "a@b.co" });
    expect(quiet).not.toContain("aria-invalid");
    expect(quiet).toMatch(/aria-describedby="[^"]+-sent"/);
  });

  it("an error from the email form sits under the field; a provider's stays at the top", () => {
    const form = signin({ email: "a@b", error: "Bad address", errorInForm: true });
    expect(form.match(/role="alert"/g)).toHaveLength(1);
    expect(form.indexOf("Bad address")).toBeGreaterThan(form.indexOf('type="email"'));
    expect(form).toMatch(/aria-describedby="([^"]+)-error"/);
    const top = signin({ error: "Apple said no" });
    expect(top.indexOf("Apple said no")).toBeLessThan(top.indexOf("Continue with Apple"));
  });

  it("digitsOnly keeps at most six ASCII digits, pasted text included", () => {
    expect(digitsOnly("12 34-56")).toBe("123456");
    expect(digitsOnly("123456789")).toBe("123456");
    expect(digitsOnly("a1b2")).toBe("12");
    expect(digitsOnly("١٢٣٤٥٦")).toBe("123456");
    expect(digitsOnly("۱۲ ۳۴")).toBe("1234");
    expect(digitsOnly("")).toBe("");
  });

  it("consent is one short line with the terms and privacy links, in both languages", () => {
    const en = signin({});
    expect(en).toMatch(
      /<p[^>]*>By continuing, you agree to the <a [^>]*href="\/terms"[^>]*>Terms<\/a> and the <a [^>]*href="\/privacy"[^>]*>Privacy Policy<\/a>\. An outside AI reads your arguments\.<\/p>/,
    );
    const tr = signin({ lang: "tr" });
    expect(tr).toMatch(
      /<p[^>]*>Devam ederek <a [^>]*href="\/terms"[^>]*>Kullanım Koşulları<\/a>&#x27;nı ve <a [^>]*href="\/privacy"[^>]*>Gizlilik Politikası<\/a>&#x27;nı kabul etmiş olursun\. Tartışmalarını harici bir yapay zekâ okur\.<\/p>/,
    );
    // Only the first screen carries it.
    expect(signin({ sentTo: "a@b.co" })).not.toContain("agree to the");
  });
});

const withPassword: AuthProviders = { apple: true, google: true, email: true, emailCode: true, password: true, dev: false };

describe("SignInPanel with passwords", () => {
  const pw = (over: Partial<SignInPanelProps> = {}) => signin({ providers: withPassword, email: "a@b.co", ...over });
  const step = (over: Partial<SignInPanelProps> = {}) => pw({ emailStep: true, ...over });

  it("the first screen is the same with passwords on", () => {
    const html = pw({});
    expect(html).toContain("Continue with Apple");
    expect(html).not.toContain('autoComplete="current-password"');
    expect(html).toContain(">Continue<");
  });

  it("an account with a password: the address with Change, the password, Sign in, forgot and code links", () => {
    const html = step({ password: "secret" });
    const order = [
      "a@b.co",
      t("en", "signin.changeEmail"),
      t("en", "signin.password"),
      t("en", "signin.passwordSubmit"),
      t("en", "signin.forgot"),
      t("en", "signin.useCode"),
    ].map((text) => html.indexOf(esc(text)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(html).not.toContain("Continue with Apple");
    expect(html).not.toContain("18 or older");
    expect(html).not.toContain(esc(t("en", "signin.create")));
  });

  it("lets a password manager find the pair, and the password can be shown", () => {
    const html = step({ password: "secret" });
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toMatch(/type="password"[^>]*value="secret"|value="secret"[^>]*type="password"/);
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Show password/);
    const shown = step({ password: "secret", showPassword: true });
    expect(shown).not.toContain('type="password"');
    expect(shown).toMatch(/aria-pressed="true"/);
  });

  it("the error sits next to the fields, once", () => {
    const html = step({ password: "x", error: "No match", errorInForm: true });
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html.indexOf("No match")).toBeGreaterThan(html.indexOf('autoComplete="current-password"'));
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/aria-describedby="([^"]+)-error"/);
  });

  it("Sign in needs a password", () => {
    const submit = (h: string) => /<button[^>]*type="submit"[^>]*>/.exec(h)![0];
    expect(submit(step({}))).toContain('disabled=""');
    expect(submit(step({ password: "secret" }))).not.toContain('disabled=""');
    expect(submit(step({ password: "secret", pending: true }))).toContain('disabled=""');
  });

  it("a new address asks for a password to create, with no other way in", () => {
    const html = step({ mode: "create", password: "secret" });
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain(esc(t("en", "signin.passwordNew")));
    expect(html).toContain(">Continue<");
    expect(html).not.toContain(esc(t("en", "signin.forgot")));
    expect(html).not.toContain(esc(t("en", "signin.useCode")));
  });

  it("the code step is the same as without passwords", () => {
    const html = pw({ sentTo: "a@b.co", code: "12", mode: "create", emailStep: true });
    expect(html).toContain("We emailed a code to a@b.co");
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).not.toContain('type="password"');
  });

  it("after the code it asks for the password to keep, with a way to skip", () => {
    const html = pw({ choosing: true, password: "", error: "Could not save", errorInForm: true });
    expect(html).toContain(esc(t("en", "signin.passwordChoose")));
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain(esc(t("en", "signin.passwordSave")));
    expect(html).toContain(">Skip<");
    expect(html).not.toContain("Continue with Apple");
    expect(html.match(/role="alert"/g)).toHaveLength(1);
  });

  it("without the password flag there is no password step", () => {
    const html = signin({ email: "a@b.co" });
    expect(html).not.toContain('type="password"');
    expect(html).toContain(">Continue<");
  });
});

describe("safeNext", () => {
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

  it("server-renders a closed signed-out avatar with Settings and Pricing", () => {
    const html = renderToStaticMarkup(<AccountMenu lang="en" />);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('href="/pricing"');
    expect(html).not.toContain(STRINGS.en["nav.signOut"]);
    expect(html).not.toContain(STRINGS.en["nav.signIn"]);
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
