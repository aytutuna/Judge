// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgeGate } from "../components/AgeGate";
import { ParentLinkScreen } from "../components/ParentLinkScreen";
import type { ParentView } from "../lib/account-types";
import { t } from "../lib/i18n";
import { refreshViewer } from "../lib/use-viewer";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

type Age = { confirmed: boolean; blocked: boolean; teen: boolean; needsDob: boolean; restricted?: boolean; parent?: "pending" | "declined" | "revoked" };
const NEEDS: Age = { confirmed: false, blocked: false, teen: false, needsDob: true };
const TEEN: Age = { confirmed: true, blocked: false, teen: true, needsDob: false };

const NOT_SENT: ParentView = { status: "pending", sent: false, emailHint: null, expiresAt: null, expired: false, resendsLeft: 3, changesLeft: 3, resendAt: null, deleteAt: null };
const SENT: ParentView = { ...NOT_SENT, sent: true, emailHint: "m***@example.com", expiresAt: "2030-01-01T00:00:00.000Z" };

type Call = { method: string; path: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
let age: Age = NEEDS;
let hint: { country: string | null; quebec: boolean | null } = { country: null, quebec: null };
let parentView: ParentView = NOT_SENT;
let answer: (call: Call) => Response | null = () => null;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  calls = [];
  age = NEEDS;
  hint = { country: null, quebec: null };
  parentView = NOT_SENT;
  answer = () => null;
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
      const raw = typeof init.body === "string" ? init.body : null;
      const call: Call = { method: init.method ?? "GET", path, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null };
      calls.push(call);
      const custom = answer(call);
      if (custom) return custom;
      if (path === "/api/v1/me" && call.method === "GET") {
        return reply(200, { user: { id: "u1", email: "teen@example.com", name: "Deniz", image: null }, entitlement: null, age });
      }
      if (path === "/api/v1/config") return reply(200, { signIn: { email: true }, premiumEnabled: true, features: {} });
      if (path === "/api/v1/me/age" && call.method === "GET") return reply(200, hint);
      if (path === "/api/v1/me/age" && call.method === "POST") return reply(200, TEEN);
      if (path === "/api/v1/me/parent" && call.method === "GET") return reply(200, parentView);
      if (path === "/api/v1/me/parent" && call.method === "POST") {
        parentView = SENT;
        return reply(200, SENT);
      }
      if (path === "/api/v1/me/parent/resend") return reply(200, SENT);
      return reply(404, { code: "not_found" });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const posts = (path: string) => calls.filter((c) => c.method === "POST" && c.path === path);
const dobInput = () => document.querySelector<HTMLInputElement>('input[type="date"]');
const countrySelect = () => document.querySelector<HTMLSelectElement>("#age-country");
const go = () => screen.getByRole("button", { name: t("en", "age.continue") }) as HTMLButtonElement;

/** A date that makes the person `years` and a bit old today. */
const born = (years: number) => `${new Date().getFullYear() - years}-01-01`;

async function openDateStep(): Promise<void> {
  await refreshViewer();
  render(<AgeGate lang="en" />);
  await waitFor(() => expect(dobInput()).not.toBeNull());
}

describe("the places questions in the date step", () => {
  it("asks a 15 year old where they live, pre-selected from the IP, and sends the answer", async () => {
    hint = { country: "DE", quebec: null };
    await openDateStep();
    await waitFor(() => expect(hint.country).toBe("DE"));
    fireEvent.change(dobInput()!, { target: { value: born(15) } });
    expect(screen.getByText(t("en", "age.whereWhy"))).toBeTruthy();
    expect(countrySelect()).not.toBeNull();
    await waitFor(() => expect(countrySelect()!.value).toBe("DE"));
    expect(go().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(go());
    });
    expect(posts("/api/v1/me/age")[0].body).toEqual({ dob: born(15), country: "DE" });
  });

  it("will not continue until a 15 year old has picked a country", async () => {
    await openDateStep();
    fireEvent.change(dobInput()!, { target: { value: born(15) } });
    expect(go().disabled).toBe(true);
    fireEvent.change(countrySelect()!, { target: { value: "FR" } });
    expect(go().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(go());
    });
    expect(posts("/api/v1/me/age")[0].body).toEqual({ dob: born(15), country: "FR" });
  });

  it("asks a 13 year old in Canada about Quebec, with the IP's answer ready, and sends it", async () => {
    hint = { country: "CA", quebec: true };
    await openDateStep();
    fireEvent.change(dobInput()!, { target: { value: born(13) } });
    await waitFor(() => expect(countrySelect()!.value).toBe("CA"));
    const yes = screen.getByLabelText(t("en", "age.yes")) as HTMLInputElement;
    const no = screen.getByLabelText(t("en", "age.no")) as HTMLInputElement;
    expect(yes.checked).toBe(true);
    fireEvent.click(no);
    await act(async () => {
      fireEvent.click(go());
    });
    expect(posts("/api/v1/me/age")[0].body).toEqual({ dob: born(13), country: "CA", quebec: false });
  });

  it("holds a 13 year old in Canada until Quebec is answered", async () => {
    hint = { country: "CA", quebec: null };
    await openDateStep();
    fireEvent.change(dobInput()!, { target: { value: born(13) } });
    await waitFor(() => expect(countrySelect()!.value).toBe("CA"));
    expect(go().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(t("en", "age.yes")));
    expect(go().disabled).toBe(false);
  });

  it("does not ask Quebec of a 14 year old or of a 13 year old elsewhere", async () => {
    hint = { country: "CA", quebec: true };
    await openDateStep();
    fireEvent.change(dobInput()!, { target: { value: born(14) } });
    await waitFor(() => expect(countrySelect()!.value).toBe("CA"));
    expect(screen.queryByText(t("en", "age.quebec"))).toBeNull();
    fireEvent.change(dobInput()!, { target: { value: born(13) } });
    fireEvent.change(countrySelect()!, { target: { value: "US" } });
    expect(screen.queryByText(t("en", "age.quebec"))).toBeNull();
  });

  it("asks nothing of a 16 year old or an adult", async () => {
    await openDateStep();
    fireEvent.change(dobInput()!, { target: { value: born(17) } });
    expect(countrySelect()).toBeNull();
    fireEvent.change(dobInput()!, { target: { value: born(40) } });
    expect(countrySelect()).toBeNull();
    expect(go().disabled).toBe(false);
  });
});

describe("the refusal for the region", () => {
  it("says Judge is for 18 and over there, with the contact address, sign out and delete", async () => {
    age = { ...TEEN, restricted: true };
    await refreshViewer();
    const { container } = render(<AgeGate lang="en" />);
    await waitFor(() => expect(container.querySelector("dialog")).not.toBeNull());
    expect(screen.getByText(t("en", "age.regionTitle"))).toBeTruthy();
    expect(screen.getByText(t("en", "age.region"))).toBeTruthy();
    expect(screen.getByRole("button", { name: t("en", "nav.signOut") })).toBeTruthy();
    expect(screen.getByRole("link", { name: t("en", "account.delete") })).toBeTruthy();
    expect(dobInput()).toBeNull();
  });
});

describe("the parent step", () => {
  const openStep = async (state: Age) => {
    age = state;
    await refreshViewer();
    render(<AgeGate lang="en" />);
  };
  const emailInput = () => document.querySelector<HTMLInputElement>("#parent-email");

  it("asks for the parent's address first, and sends it", async () => {
    await openStep({ ...TEEN, parent: "pending" });
    await waitFor(() => expect(emailInput()).not.toBeNull());
    expect(screen.getByText(t("en", "age.parentTitle"))).toBeTruthy();
    const send = screen.getByRole("button", { name: t("en", "age.parentSend") }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(emailInput()!, { target: { value: "mom@example.com" } });
    expect(send.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(send);
    });
    expect(posts("/api/v1/me/parent")).toEqual([{ method: "POST", path: "/api/v1/me/parent", body: { email: "mom@example.com" } }]);
    expect(await screen.findByText(t("en", "age.parentSentTo", { email: "m***@example.com" }))).toBeTruthy();
  });

  it("shows where it stands when the link was sent, and can send again or change the address", async () => {
    parentView = SENT;
    await openStep({ ...TEEN, parent: "pending" });
    expect(await screen.findByText(t("en", "age.parentSentTo", { email: "m***@example.com" }))).toBeTruthy();
    expect(screen.getByText(t("en", "age.parentWaitTitle"))).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("en", "age.parentResend") }));
    });
    expect(posts("/api/v1/me/parent/resend")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: t("en", "age.parentChange") }));
    await waitFor(() => expect(emailInput()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: t("en", "age.parentCancel") }));
    expect(await screen.findByText(t("en", "age.parentWaitTitle"))).toBeTruthy();
  });

  it("says the link expired, and turns off a send that has no tries left", async () => {
    parentView = { ...SENT, expired: true, resendsLeft: 0, changesLeft: 0 };
    await openStep({ ...TEEN, parent: "pending" });
    expect(await screen.findByText(t("en", "age.parentExpired"))).toBeTruthy();
    expect((screen.getByRole("button", { name: t("en", "age.parentResend") }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: t("en", "age.parentChange") }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the server's reason in the person's language when a send is refused", async () => {
    answer = (c) => (c.method === "POST" && c.path === "/api/v1/me/parent" ? reply(400, { code: "parent_email", error: "x" }) : null);
    await openStep({ ...TEEN, parent: "pending" });
    await waitFor(() => expect(emailInput()).not.toBeNull());
    fireEvent.change(emailInput()!, { target: { value: "teen@example.com" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("en", "age.parentSend") }));
    });
    expect((await screen.findByRole("alert")).textContent).toBe(t("en", "error.parent_email"));
  });

  it("tells a teen whose parent said no, with sign out and delete", async () => {
    await openStep({ ...TEEN, parent: "declined" });
    expect(await screen.findByText(t("en", "age.parentDeclinedTitle"))).toBeTruthy();
    expect(screen.getByText(t("en", "age.parentDeclined"))).toBeTruthy();
    expect(screen.getByRole("link", { name: t("en", "account.delete") })).toBeTruthy();
    expect(emailInput()).toBeNull();
  });

  it("lets a teen whose parent withdrew ask again", async () => {
    await openStep({ ...TEEN, parent: "revoked" });
    expect(await screen.findByText(t("en", "age.parentRevokedTitle"))).toBeTruthy();
    await waitFor(() => expect(emailInput()).not.toBeNull());
  });

  it("closes by itself once the parent has approved", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      parentView = SENT;
      await openStep({ ...TEEN, parent: "pending" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      age = TEEN;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(document.querySelector("dialog")).toBeNull());
  });
});

describe("the parent's page", () => {
  const TOKEN = "A".repeat(43);
  let link: unknown = { kind: "request", name: "Deniz", usable: true };

  beforeEach(() => {
    link = { kind: "request", name: "Deniz", usable: true };
    answer = (c) => {
      if (c.path === `/api/v1/parent/${TOKEN}` && c.method === "GET") return link === null ? reply(404, { code: "parent_link" }) : reply(200, link);
      if (c.path === `/api/v1/parent/${TOKEN}` && c.method === "POST") {
        const action = c.body?.action as string;
        return reply(200, { result: action === "approve" ? "approved" : action === "decline" ? "declined" : "withdrawn" });
      }
      return null;
    };
  });

  it("shows what Judge is and what it does for teens, and approves only after the tick", async () => {
    render(<ParentLinkScreen token={TOKEN} declineFirst={false} />);
    expect(await screen.findByText(t("en", "parent.title", { name: "Deniz" }))).toBeTruthy();
    expect(screen.getByText(t("en", "parent.what"))).toBeTruthy();
    for (const key of ["parent.rule1", "parent.rule2", "parent.rule3", "parent.rule4"] as const) {
      expect(screen.getByText(t("en", key))).toBeTruthy();
    }
    const approve = screen.getByRole("button", { name: t("en", "parent.approve") }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(t("en", "parent.tick", { name: "Deniz" })));
    expect(approve.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(approve);
    });
    expect(calls.filter((c) => c.method === "POST")[0].body).toEqual({ action: "approve", guardian: true });
    expect(await screen.findByText(t("en", "parent.approvedDone", { name: "Deniz" }))).toBeTruthy();
  });

  it("declines without the tick", async () => {
    render(<ParentLinkScreen token={TOKEN} declineFirst />);
    await screen.findByText(t("en", "parent.title", { name: "Deniz" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("en", "parent.decline") }));
    });
    expect(calls.filter((c) => c.method === "POST")[0].body).toEqual({ action: "decline" });
    expect(await screen.findByText(t("en", "parent.declinedDone", { name: "Deniz" }))).toBeTruthy();
  });

  it("withdraws from the confirmation link", async () => {
    link = { kind: "withdraw", name: "Deniz", usable: true };
    render(<ParentLinkScreen token={TOKEN} declineFirst={false} />);
    expect(await screen.findByText(t("en", "parent.withdrawTitle", { name: "Deniz" }))).toBeTruthy();
    expect(screen.getByText(t("en", "parent.withdrawLead"))).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("en", "parent.withdraw") }));
    });
    expect(calls.filter((c) => c.method === "POST")[0].body).toEqual({ action: "withdraw" });
    expect(await screen.findByText(t("en", "parent.withdrawnDone", { name: "Deniz" }))).toBeTruthy();
  });

  it("says a link that is unknown, used or expired does not work", async () => {
    link = null;
    const { unmount } = render(<ParentLinkScreen token={TOKEN} declineFirst={false} />);
    expect(await screen.findByText(t("en", "error.parent_link"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("en", "parent.approve") })).toBeNull();
    unmount();
    link = { kind: "request", name: "Deniz", usable: false };
    render(<ParentLinkScreen token={TOKEN} declineFirst={false} />);
    expect(await screen.findByText(t("en", "error.parent_link"))).toBeTruthy();
  });

  it("shows the server's reason when the decision is refused", async () => {
    answer = (c) => {
      if (c.method === "GET") return reply(200, link);
      return reply(404, { code: "parent_link", error: "x" });
    };
    render(<ParentLinkScreen token={TOKEN} declineFirst={false} />);
    await screen.findByText(t("en", "parent.title", { name: "Deniz" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("en", "parent.decline") }));
    });
    expect((await screen.findByRole("alert")).textContent).toBe(t("en", "error.parent_link"));
  });
});
