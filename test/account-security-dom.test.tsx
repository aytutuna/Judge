// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountDetailPanel, AccountDetailSection, SignOutRow } from "../components/account/AccountView";
import { PasswordForm } from "../components/account/PasswordForm";
import { SettingsView } from "../components/account/SettingsView";
import { DeleteAccountPage } from "../components/DeleteAccountPage";
import { useMine } from "../components/OwnerTools";
import { useCase } from "../lib/use-case";
import type { Entitlement, GrantSource, MeResponse } from "../lib/account-types";
import { ANSWERED_KEY, HISTORY_KEY } from "../lib/history-store";
import { t } from "../lib/i18n";
import { storeBilling } from "../lib/plan-billing";
import { markSignedOut, refreshViewer, type ViewerState } from "../lib/use-viewer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings",
}));
vi.mock("../components/shell/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");
const KEPT_KEY = "verdict-theme";
const user = { id: "u1", email: "ada@example.org", name: "Ada", image: null };

function entitlement(source: GrantSource | null, willRenew = true): Entitlement {
  return {
    canUsePremium: true,
    blockedReason: null,
    credits: 0,
    resetsAt: null,
    subscription: source
      ? {
          source,
          productId: "monthly",
          periodStart: "2026-10-19T12:00:00.000Z",
          periodEnd: "2026-11-18T12:00:00.000Z",
          willRenew,
          used: 1,
          cap: 35,
        }
      : null,
  };
}

const ready = (me: MeResponse): ViewerState => ({ status: "ready", me, config: null });

function detail(me: MeResponse): string {
  return renderToStaticMarkup(
    <AccountDetailPanel lang="en" viewer={ready(me)} deleting={false} deleted={false} deleteError={null} onDelete={() => {}} />,
  );
}

describe("storeBilling", () => {
  it("picks the store by where the plan was bought", () => {
    expect(storeBilling(entitlement("app_store").subscription)).toEqual({
      store: "apple",
      manageUrl: "https://apps.apple.com/account/subscriptions",
    });
    expect(storeBilling(entitlement("play_store").subscription)).toEqual({
      store: "google",
      manageUrl: "https://play.google.com/store/account/subscriptions",
    });
  });

  it("is null without a plan, for a plan that ends by itself and for other sources", () => {
    expect(storeBilling(null)).toBeNull();
    expect(storeBilling(entitlement("app_store", false).subscription)).toBeNull();
    for (const source of ["web", "admin", "promo"] as const) {
      expect(storeBilling(entitlement(source).subscription)).toBeNull();
    }
  });
});

describe("the delete dialog", () => {
  it("warns about the App Store and links to its subscriptions", () => {
    const html = detail({ user, entitlement: entitlement("app_store") });
    expect(html).toContain(esc(t("en", "settings.deleteBillingApple")));
    expect(html).toContain('href="https://apps.apple.com/account/subscriptions"');
    expect(html).not.toContain(esc(t("en", "settings.deleteBillingGoogle")));
  });

  it("warns about Google Play and links to its subscriptions", () => {
    const html = detail({ user, entitlement: entitlement("play_store") });
    expect(html).toContain(esc(t("en", "settings.deleteBillingGoogle")));
    expect(html).toContain('href="https://play.google.com/store/account/subscriptions"');
    expect(html).not.toContain(esc(t("en", "settings.deleteBillingApple")));
  });

  it("says nothing about a store when none bills the plan", () => {
    for (const ent of [entitlement(null), entitlement("app_store", false), entitlement("web")]) {
      const html = detail({ user, entitlement: ent });
      expect(html).not.toContain(esc(t("en", "settings.manageSubscription")));
    }
  });

  it("asks for the password only on an account that has one", () => {
    expect(detail({ user, entitlement: entitlement(null), hasPassword: true })).toContain('id="delete-password"');
    expect(detail({ user, entitlement: entitlement(null), hasPassword: false })).not.toContain('id="delete-password"');
  });

  it("the public page tells about store plans", () => {
    const html = renderToStaticMarkup(<DeleteAccountPage contactEmail={null} />).replace(/ /g, " ");
    expect(html).toContain(esc(t("en", "deletePage.billingTitle")));
    expect(html).toContain(esc(t("en", "deletePage.billing")));
  });
});

type Call = { method: string; path: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
let answer: (call: Call) => Response | null = () => null;
let me: MeResponse = { user, entitlement: entitlement(null), hasPassword: true };

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  calls = [];
  answer = () => null;
  me = { user, entitlement: entitlement(null), hasPassword: true };
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input);
      const raw = typeof init.body === "string" ? init.body : null;
      const call: Call = { method: init.method ?? "GET", path, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null };
      calls.push(call);
      if (path === "/api/v1/me" && call.method === "GET") return reply(200, me);
      if (path === "/api/v1/config") return reply(200, { signIn: { email: true }, premiumEnabled: true, features: {} });
      if (path === "/api/v1/me/consent") return reply(200, { state: "off" });
      return answer(call) ?? reply(404, { code: "not_found" });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PasswordForm", () => {
  it("sends the current and the new password with the page language", async () => {
    answer = () => reply(200, { ok: true });
    render(<PasswordForm lang="en" />);
    fireEvent.change(screen.getByLabelText(t("en", "settings.passwordCurrent")), { target: { value: "old password" } });
    fireEvent.change(screen.getByLabelText(t("en", "signin.passwordNew")), { target: { value: "new password" } });
    fireEvent.click(screen.getByRole("button", { name: t("en", "settings.passwordChange") }));
    await screen.findByText(t("en", "settings.passwordChanged"));
    const sent = calls.find((c) => c.method === "POST");
    expect(sent?.path).toBe("/api/v1/me/password?lang=en");
    expect(sent?.body).toEqual({ password: "new password", current: "old password" });
    expect((screen.getByLabelText(t("en", "settings.passwordCurrent")) as HTMLInputElement).value).toBe("");
  });

  it("shows the server's refusal and keeps what was typed", async () => {
    answer = () => reply(403, { code: "password_wrong", error: "no" });
    render(<PasswordForm lang="en" />);
    fireEvent.change(screen.getByLabelText(t("en", "settings.passwordCurrent")), { target: { value: "wrong one" } });
    fireEvent.change(screen.getByLabelText(t("en", "signin.passwordNew")), { target: { value: "new password" } });
    fireEvent.click(screen.getByRole("button", { name: t("en", "settings.passwordChange") }));
    expect((await screen.findByRole("alert")).textContent).toBe(t("en", "error.password_wrong"));
    expect(screen.queryByText(t("en", "settings.passwordChanged"))).toBeNull();
  });

  it("refuses a short new password without asking the server", async () => {
    render(<PasswordForm lang="en" />);
    fireEvent.change(screen.getByLabelText(t("en", "settings.passwordCurrent")), { target: { value: "old password" } });
    fireEvent.change(screen.getByLabelText(t("en", "signin.passwordNew")), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: t("en", "settings.passwordChange") }));
    expect((await screen.findByRole("alert")).textContent).toBe(t("en", "signin.passwordShort"));
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("Settings", () => {
  it("offers Change password to an account with a password only", async () => {
    await refreshViewer();
    const { unmount } = render(<SettingsView />);
    await screen.findByRole("heading", { name: t("en", "settings.passwordChange") });
    unmount();

    me = { user, entitlement: entitlement(null), hasPassword: false };
    await refreshViewer();
    render(<SettingsView />);
    await screen.findByText(t("en", "account.signedInAs", { email: user.email }));
    expect(screen.queryByRole("heading", { name: t("en", "settings.passwordChange") })).toBeNull();
  });
});

function fillBrowser(): void {
  localStorage.setItem("settle.names.case1.a", JSON.stringify([{ real: "Ada Lovelace", alias: "Person A" }]));
  localStorage.setItem("judge.lastSignin", JSON.stringify({ method: "email", email: "ada@example.org" }));
  localStorage.setItem("judge.signinPending", JSON.stringify({ method: "email", email: "ada@example.org" }));
  localStorage.setItem(HISTORY_KEY, JSON.stringify([{ id: "v1", createdAt: "2026-10-20T09:00:00.000Z", headline: "Rent" }]));
  localStorage.setItem(ANSWERED_KEY, "[]");
  localStorage.setItem("judge.owner.v1", "A".repeat(32));
  localStorage.setItem(KEPT_KEY, "dark");
}

function expectBrowserClean(): void {
  const keys = Object.keys(localStorage);
  expect(keys.filter((k) => /^(settle\.names\.|judge\.(lastSignin|signinPending|history|owner\.))/.test(k))).toEqual([]);
  expect(JSON.stringify(Object.values(localStorage))).not.toContain("ada@example.org");
  expect(JSON.stringify(Object.values(localStorage))).not.toContain("Ada Lovelace");
  expect(localStorage.getItem(KEPT_KEY)).toBe("dark");
}

describe("what the account leaves in the browser", () => {
  it("markSignedOut clears names, the last address, lists and tokens but not the language", () => {
    fillBrowser();
    markSignedOut();
    expectBrowserClean();
  });

  it("the Sign out button does the same", async () => {
    await refreshViewer();
    vi.doMock("../lib/auth-client", async (orig) => ({ ...(await orig<typeof import("../lib/auth-client")>()), signOut: async () => {} }));
    fillBrowser();
    render(<SignOutRow />);
    fireEvent.click(await screen.findByRole("button", { name: t("en", "account.signOut") }));
    await waitFor(() => expectBrowserClean());
  });

  it("deleting the account sends the password and forgets the email", async () => {
    await refreshViewer();
    answer = (c) => (c.method === "DELETE" ? reply(200, { deleted: true }) : null);
    fillBrowser();
    render(<AccountDetailSection />);
    fireEvent.change(await screen.findByLabelText(t("en", "settings.deletePassword")), { target: { value: "my password" } });
    fireEvent.click(screen.getByRole("button", { name: t("en", "account.deleteYes"), hidden: true }));
    await screen.findByText(t("en", "account.deleted"));
    expect(calls.find((c) => c.method === "DELETE")?.body).toEqual({ confirm: "delete", password: "my password" });
    expectBrowserClean();
  });

  it("deleting without a recent sign-in says so and keeps the browser data", async () => {
    me = { user, entitlement: entitlement(null), hasPassword: false };
    await refreshViewer();
    answer = (c) => (c.method === "DELETE" ? reply(403, { code: "reauth_required", error: "x" }) : null);
    fillBrowser();
    render(<AccountDetailSection />);
    fireEvent.click(await screen.findByRole("button", { name: t("en", "account.deleteYes"), hidden: true }));
    expect((await screen.findByRole("alert")).textContent).toBe(t("en", "error.reauth_required"));
    expect(localStorage.getItem("judge.lastSignin")).not.toBeNull();
  });

  it("a viewer that was signed in here and now answers signed out forgets the data; a stranger's tokens stay", async () => {
    me = { user: null, entitlement: null, age: null };
    markSignedOut();
    localStorage.setItem("judge.owner.v9", "B".repeat(32));
    await refreshViewer();
    expect(localStorage.getItem("judge.owner.v9")).not.toBeNull();
    fillBrowser();
    await refreshViewer();
    expectBrowserClean();
  });

  it("an account with a password that leaves the field empty is told to type it", async () => {
    await refreshViewer();
    answer = (c) => (c.method === "DELETE" ? reply(403, { code: "reauth_required", error: "x" }) : null);
    render(<AccountDetailSection />);
    fireEvent.click(await screen.findByRole("button", { name: t("en", "account.deleteYes"), hidden: true }));
    expect((await screen.findByRole("alert")).textContent).toBe(t("en", "error.password_required"));
  });

  it("a rate-limited deletion does not promise a wait of a minute", async () => {
    await refreshViewer();
    answer = (c) => (c.method === "DELETE" ? reply(429, { code: "rate_limited", error: "x" }) : null);
    render(<AccountDetailSection />);
    fireEvent.click(await screen.findByRole("button", { name: t("en", "account.deleteYes"), hidden: true }));
    expect((await screen.findByRole("alert")).textContent).toBe(t("en", "account.deleteLimited"));
  });

  it("closing the delete dialog forgets the typed password", async () => {
    await refreshViewer();
    render(<AccountDetailSection />);
    const input = (await screen.findByLabelText(t("en", "settings.deletePassword"))) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "typed" } });
    expect(input.value).toBe("typed");
    fireEvent(input.closest("dialog")!, new Event("close"));
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("an open case view goes with the sign-in even when the refetch fails", async () => {
    await refreshViewer();
    answer = (c) => (c.path === "/api/v1/cases/c1" ? reply(200, { case: { id: "c1", status: "open", pollAfterMs: null } }) : null);
    const { result } = renderHook(() => useCase("/api/v1/cases/c1"));
    await waitFor(() => expect(result.current.load.view?.id).toBe("c1"));
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await act(async () => markSignedOut());
    await waitFor(() => expect(result.current.load.view).toBeNull());
  });

  it("the writer view goes when the sign-in does", async () => {
    answer = (c) => (c.path.endsWith("/mine") ? reply(200, { id: "v1" }) : null);
    const { result, rerender } = renderHook(({ signedIn }) => useMine("v1", null, signedIn), {
      initialProps: { signedIn: true },
    });
    await waitFor(() => expect(result.current?.id).toBe("v1"));
    await act(async () => rerender({ signedIn: false }));
    expect(result.current).toBeNull();
  });
});
