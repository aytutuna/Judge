// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SignInView } from "../components/account/SignInView";

const calls = vi.hoisted(() => ({ save: [] as unknown[][] }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/signin" }));
vi.mock("../lib/auth-client", async (orig) => ({
  ...(await orig<typeof import("../lib/auth-client")>()),
  signInWithCode: async () => ({ ok: true }),
  savePassword: async (...args: unknown[]) => {
    calls.save.push(args);
    return { ok: true };
  },
}));

beforeEach(() => {
  calls.save = [];
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("verdict-lang", "de");
  sessionStorage.setItem("signin_sent_to", "ada@example.org");
  sessionStorage.setItem("signin_mode", "forgot");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const body =
        String(input) === "/api/v1/config"
          ? { signIn: { email: true, emailCode: true, password: true }, premiumEnabled: true, features: {} }
          : { user: null, entitlement: null, age: null };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("forgot password asks the server to write the change notice in the page language", async () => {
  render(<SignInView />);
  const code = await screen.findByRole("textbox");
  fireEvent.change(code, { target: { value: "123456" } });
  await waitFor(() => expect(document.querySelector("input[autocomplete=new-password]")).not.toBeNull());
  const password = document.querySelector<HTMLInputElement>("input[autocomplete=new-password]")!;
  fireEvent.change(password, { target: { value: "a brand new password" } });
  fireEvent.submit(password.closest("form")!);
  await waitFor(() => expect(calls.save).toHaveLength(1));
  expect(calls.save[0]).toEqual(["a brand new password", undefined, "de"]);
});
