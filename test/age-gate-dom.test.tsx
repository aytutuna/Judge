// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgeGate } from "../components/AgeGate";
import { SettingsView } from "../components/account/SettingsView";
import { t } from "../lib/i18n";
import { refreshViewer } from "../lib/use-viewer";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

type Age = { confirmed: boolean; blocked: boolean; teen: boolean; needsDob: boolean };
const NEEDS: Age = { confirmed: false, blocked: false, teen: false, needsDob: true };
const ADULT: Age = { confirmed: true, blocked: false, teen: false, needsDob: false };
const TEEN: Age = { confirmed: true, blocked: false, teen: true, needsDob: false };

let age: Age = NEEDS;
let posts: { path: string; body: unknown }[] = [];
let answer: (body: { dob?: string }) => Response = () => reply(200, ADULT);

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  age = NEEDS;
  posts = [];
  answer = () => reply(200, ADULT);
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input);
      if (path === "/api/v1/me" && !init.method) {
        return reply(200, { user: { id: "u1", email: "b@example.com", name: "Deniz", image: null }, entitlement: null, age });
      }
      if (path === "/api/v1/config") return reply(200, { signIn: { email: true }, premiumEnabled: true, features: {} });
      if (path === "/api/v1/me/consent") return reply(200, { state: "off", ask: false });
      if (init.method === "POST") {
        const body = JSON.parse(String(init.body)) as { dob?: string };
        posts.push({ path, body });
        return answer(body);
      }
      return reply(404, { code: "not_found" });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const dobInput = () => document.querySelector<HTMLInputElement>('input[type="date"]');

describe("AgeGate", () => {
  it("asks for a date of birth once, with the reason, and sends it", async () => {
    await refreshViewer();
    render(<AgeGate lang="en" />);
    await waitFor(() => expect(dobInput()).not.toBeNull());
    expect(screen.getByText(t("en", "age.lead"))).toBeTruthy();
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    const go = screen.getByRole("button", { name: t("en", "age.continue") }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);

    fireEvent.change(dobInput()!, { target: { value: "1990-04-02" } });
    expect(go.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(go);
    });
    expect(posts).toEqual([{ path: "/api/v1/me/age", body: { dob: "1990-04-02" } }]);
    await waitFor(() => expect(dobInput()).toBeNull());
  });

  it("asks to confirm an under-13 date before sending, and Change goes back", async () => {
    answer = () => reply(200, { confirmed: false, blocked: true, teen: false, needsDob: false });
    await refreshViewer();
    render(<AgeGate lang="en" />);
    await waitFor(() => expect(dobInput()).not.toBeNull());
    const year = new Date().getFullYear() - 10;
    fireEvent.change(dobInput()!, { target: { value: `${year}-06-01` } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("en", "age.continue") }));
    });
    expect(posts).toEqual([]);
    expect(screen.getByText(t("en", "age.confirmDate", { date: `June 1, ${year}` }))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: t("en", "age.change") }));
    expect(dobInput()).not.toBeNull();
    expect((dobInput() as HTMLInputElement).value).toBe(`${year}-06-01`);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("en", "age.continue") }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("en", "age.confirmYes") }));
    });
    expect(posts).toEqual([{ path: "/api/v1/me/age", body: { dob: `${year}-06-01` } }]);
    expect(await screen.findByText(t("en", "age.blockedTitle"))).toBeTruthy();
    expect(screen.getByText(t("en", "age.blocked"))).toBeTruthy();
    expect(dobInput()).toBeNull();
  });

  it("a teen date is sent at once, and Enter in the field submits", async () => {
    answer = () => reply(200, TEEN);
    await refreshViewer();
    render(<AgeGate lang="en" />);
    await waitFor(() => expect(dobInput()).not.toBeNull());
    fireEvent.change(dobInput()!, { target: { value: `${new Date().getFullYear() - 15}-06-01` } });
    await act(async () => {
      fireEvent.submit(dobInput()!.closest("form")!);
    });
    expect(posts).toHaveLength(1);
    await waitFor(() => expect(dobInput()).toBeNull());
  });

  it("a block from the old rule gets the date step", async () => {
    age = { confirmed: false, blocked: true, teen: false, needsDob: true };
    await refreshViewer();
    render(<AgeGate lang="en" />);
    await waitFor(() => expect(dobInput()).not.toBeNull());
  });

  it("reloads the account when the server says the date is already there, instead of failing", async () => {
    answer = () => {
      age = ADULT;
      return reply(409, { code: "age_set" });
    };
    await refreshViewer();
    const { container } = render(<AgeGate lang="en" />);
    await waitFor(() => expect(dobInput()).not.toBeNull());
    fireEvent.change(dobInput()!, { target: { value: "1990-04-02" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("en", "age.continue") }));
    });
    await waitFor(() => expect(container.querySelector("dialog")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not stay stuck when the request itself fails", async () => {
    await refreshViewer();
    render(<AgeGate lang="en" />);
    await waitFor(() => expect(dobInput()).not.toBeNull());
    fireEvent.change(dobInput()!, { target: { value: "1990-04-02" } });
    answer = () => {
      throw new Error("offline");
    };
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("en", "age.continue") }));
    });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((screen.getByRole("button", { name: t("en", "age.continue") }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("stays out of the way once a date is on file", async () => {
    age = ADULT;
    await refreshViewer();
    const { container } = render(<AgeGate lang="en" />);
    expect(container.querySelector("dialog")).toBeNull();
  });
});

describe("Settings for a teen", () => {
  const stats = () => screen.getByRole("switch", { name: t("en", "settings.usageStats") }) as HTMLInputElement;

  it("shows usage statistics off and locked, and no training switch", async () => {
    age = TEEN;
    await refreshViewer();
    render(<SettingsView />);
    await waitFor(() => expect(stats()).toBeTruthy());
    expect(stats().checked).toBe(false);
    expect(stats().disabled).toBe(true);
    expect(screen.getByText(t("en", "settings.usageStatsTeen"))).toBeTruthy();
    expect(screen.queryByRole("switch", { name: t("en", "consent.switchTitle") })).toBeNull();
  });

  it("shows the statistics switch off when the browser asks not to be tracked", async () => {
    age = ADULT;
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    await refreshViewer();
    render(<SettingsView />);
    await waitFor(() => expect(stats()).toBeTruthy());
    await waitFor(() => expect(stats().disabled).toBe(true));
    expect(stats().checked).toBe(false);
    expect(screen.getByText(t("en", "settings.usageStatsBrowser"))).toBeTruthy();
    Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
  });

  it("an adult has both switches, and the statistics one is on until switched off", async () => {
    age = ADULT;
    await refreshViewer();
    render(<SettingsView />);
    await waitFor(() => expect(stats()).toBeTruthy());
    expect(stats().checked).toBe(true);
    expect(stats().disabled).toBe(false);
    expect(screen.getByRole("switch", { name: t("en", "consent.switchTitle") })).toBeTruthy();
    fireEvent.click(stats());
    expect(stats().checked).toBe(false);
    expect(localStorage.getItem("judge.usageStatsOff")).toBe("1");
    fireEvent.click(stats());
    expect(localStorage.getItem("judge.usageStatsOff")).toBeNull();
  });
});
