// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESPOND_SIGNIN_HREF, RespondScreen } from "../components/case/RespondScreen";
import { saveCaseNames } from "../lib/case-names-store";
import type { CaseView } from "../lib/case-types";
import { ANSWERED_KEY } from "../lib/history-store";
import { t } from "../lib/i18n";
import { refreshViewer } from "../lib/use-viewer";
import { APPEAL_RESULT, RESPONDENT, RESPONDENT_NAMES, TWO_SIDED_RESULT, caseView, verdictView } from "./ui-case-fixtures";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const CLAIM = "ZyXwVuTsRqPoNmLkJiHgFe";
const BASE = `/api/v1/respond/${TOKEN}`;
const CLAIM_PATH = "/api/v1/cases/case123/claim";
const TYPED = "I paid the April bill on the third by transfer.";

type Call = { method: string; path: string; body: Record<string, unknown> | null };
type Route = (call: Call) => Response | null | Promise<Response>;

let calls: Call[] = [];
let route: Route = () => null;
let signedIn = true;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function posts(path: string): Call[] {
  return calls.filter((c) => c.method === "POST" && c.path === path);
}

function gets(path: string): Call[] {
  return calls.filter((c) => c.method === "GET" && c.path === path);
}

beforeEach(() => {
  calls = [];
  route = () => null;
  signedIn = true;
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input);
      const raw = typeof init.body === "string" ? init.body : null;
      const call: Call = { method: init.method ?? "GET", path, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null };
      calls.push(call);
      if (path === "/api/v1/me") {
        return signedIn
          ? reply(200, { user: { id: "u1", email: "b@example.com", name: "Deniz Test", image: null }, entitlement: null, age: { confirmed: true, blocked: false } })
          : reply(401, { code: "signin_required" });
      }
      if (path === "/api/v1/config") {
        return reply(200, { signIn: { email: true }, premiumEnabled: true, features: { cases: true, evidence: false } });
      }
      return (await route(call)) ?? reply(404, { code: "not_found" });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open(): Promise<void> {
  await refreshViewer();
  render(<RespondScreen token={TOKEN} />);
}

function storeClaim(caseId: string): void {
  localStorage.setItem(`settle.claim.${caseId}`, CLAIM);
}

function storeAnsweredRow(caseId: string): void {
  localStorage.setItem(
    ANSWERED_KEY,
    JSON.stringify([
      {
        kind: "case",
        id: caseId,
        role: "respondent",
        party: "b",
        at: "2026-10-20T09:00:00.000Z",
        state: "awaiting",
        inviteToken: TOKEN,
        nameMap: [],
      },
    ]),
  );
}

function mainEl(): HTMLElement {
  return screen.getByRole("main");
}

function signInLinks(): HTMLElement[] {
  return screen.queryAllByRole("link", { name: t("en", "nav.signIn") }).filter((a) => a.getAttribute("href") === RESPOND_SIGNIN_HREF);
}

const retryLabel = t("en", "case.retry");

describe("RespondScreen, signed out", () => {
  it("shows the invite facts and Sign in, and takes no seat", async () => {
    signedIn = false;
    route = (c) => (c.path === BASE ? reply(200, { case: RESPONDENT.form }) : null);
    await open();
    await waitFor(() => expect(signInLinks()).toHaveLength(1));
    expect(mainEl().textContent).toContain(t("en", "respond.lang", { lang: "English" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(calls.filter((c) => c.path.endsWith("/open"))).toHaveLength(0);
  });
});

describe("RespondScreen, linking an earlier answer", () => {
  it("links a stored claim before any seat is taken, then reloads the view", async () => {
    storeClaim("case123");
    storeAnsweredRow("case123");
    let reads = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    route = (c) => {
      if (c.path === BASE) {
        if (++reads === 1) return reply(200, { case: RESPONDENT.form });
        return gate.then(() => reply(200, { case: RESPONDENT.judgedPremium }));
      }
      if (c.path === CLAIM_PATH) return reply(200, { ok: true });
      if (c.path === `${BASE}/open`) return reply(200, { case: RESPONDENT.form, respondent_claim: null });
      return null;
    };
    await open();
    await waitFor(() => expect(gets(BASE)).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(posts(CLAIM_PATH)).toHaveLength(1);
    expect(posts(`${BASE}/open`)).toHaveLength(0);
    release();
    expect((await screen.findAllByText("Party B (you)")).length).toBeGreaterThan(0);
    expect(posts(CLAIM_PATH)).toHaveLength(1);
    expect(posts(`${BASE}/open`)).toHaveLength(0);
    expect(gets(BASE).length).toBeGreaterThanOrEqual(2);
    expect(localStorage.getItem("settle.claim.case123")).toBeNull();
  });

  it("an immediate claim reply: no seat is taken until the load after the link has landed", async () => {
    storeClaim("case123");
    storeAnsweredRow("case123");
    let reads = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    route = (c) => {
      if (c.path === BASE) {
        if (++reads === 1) return reply(200, { case: RESPONDENT.form });
        return gate.then(() => reply(200, { case: RESPONDENT.form }));
      }
      if (c.path === CLAIM_PATH) return reply(200, { ok: true });
      if (c.path === `${BASE}/open`) return reply(200, { case: RESPONDENT.form, respondent_claim: null });
      return null;
    };
    await open();
    await waitFor(() => expect(gets(BASE)).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(posts(CLAIM_PATH)).toHaveLength(1);
    expect(posts(`${BASE}/open`)).toHaveLength(0);
    release();
    await waitFor(() => expect(posts(`${BASE}/open`)).toHaveLength(1));
    const last = calls.map((c) => `${c.method} ${c.path}`);
    expect(last.lastIndexOf(`GET ${BASE}`)).toBeLessThan(last.indexOf(`POST ${BASE}/open`));
  });

  it("claim answers 5xx: no seat is taken, Retry shows and runs the link again", async () => {
    storeClaim("case123");
    storeAnsweredRow("case123");
    let claims = 0;
    route = (c) => {
      if (c.path === BASE) return reply(200, { case: RESPONDENT.form });
      if (c.path === CLAIM_PATH) return ++claims === 1 ? reply(503, { code: "unavailable" }) : reply(200, { ok: true });
      if (c.path === `${BASE}/open`) return reply(200, { case: RESPONDENT.form, respondent_claim: null });
      return null;
    };
    await open();
    const retry = await screen.findByRole("button", { name: retryLabel });
    expect(mainEl().textContent).toContain(t("en", "case.loadFailed"));
    expect(posts(`${BASE}/open`)).toHaveLength(0);
    fireEvent.click(retry);
    await waitFor(() => expect(posts(CLAIM_PATH)).toHaveLength(2));
    await waitFor(() => expect(posts(`${BASE}/open`)).toHaveLength(1));
  });

  it("claim answers 401: the viewer is looked up again and Sign in shows, not a dead Retry", async () => {
    storeClaim("case123");
    storeAnsweredRow("case123");
    route = (c) => {
      if (c.path === BASE) return reply(200, { case: RESPONDENT.form });
      if (c.path === CLAIM_PATH) {
        signedIn = false;
        return reply(401, { code: "signin_required" });
      }
      return null;
    };
    await open();
    await waitFor(() => expect(signInLinks()).toHaveLength(1));
    expect(screen.queryByRole("button", { name: retryLabel })).toBeNull();
    expect(gets("/api/v1/me").length).toBeGreaterThanOrEqual(2);
    expect(posts(`${BASE}/open`)).toHaveLength(0);
  });

  it("closed invite, claims left in this browser, no matching row: they are swept once and the page reloads", async () => {
    storeClaim("old1");
    let reads = 0;
    route = (c) => {
      if (c.path === BASE) {
        return ++reads === 1 ? reply(410, { code: "case_closed" }) : reply(200, { case: caseView({ ...RESPONDENT.judgedPremium, id: "old1" }) });
      }
      if (c.path === "/api/v1/cases/old1/claim") return reply(200, { ok: true });
      return null;
    };
    await open();
    expect((await screen.findAllByText("Party B (you)")).length).toBeGreaterThan(0);
    expect(posts("/api/v1/cases/old1/claim")).toHaveLength(1);
    expect(gets(BASE)).toHaveLength(2);
  });

  it("closed invite with nothing to link: it reads closed and no claim is sent", async () => {
    route = (c) => (c.path === BASE ? reply(410, { code: "case_closed" }) : null);
    await open();
    expect(await screen.findByText(t("en", "respond.closed"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: retryLabel })).toBeNull();
    expect(calls.filter((c) => c.path.endsWith("/claim"))).toHaveLength(0);
  });

  it("closed invite while the link is blocked: the retry wins over closed", async () => {
    storeClaim("case123");
    storeAnsweredRow("case123");
    route = (c) => {
      if (c.path === BASE) return reply(410, { code: "case_closed" });
      if (c.path === CLAIM_PATH) return reply(500, { code: "internal" });
      return null;
    };
    await open();
    expect(await screen.findByRole("button", { name: retryLabel })).toBeTruthy();
    expect(mainEl().textContent).not.toContain(t("en", "respond.closed"));
    expect(mainEl().textContent).toContain(t("en", "case.loadFailed"));
  });
});

describe("RespondScreen, answering", () => {
  it("seat_moved: the page opens again in place, moves to the new side and keeps the typed text", async () => {
    let opens = 0;
    let answers = 0;
    route = (c) => {
      if (c.method === "GET" && c.path === BASE) return reply(200, { case: RESPONDENT.form });
      if (c.path === `${BASE}/open`) {
        const party = ++opens === 1 ? "b" : "c";
        return reply(200, { case: caseView({ ...RESPONDENT.form, yourParty: party }), respondent_claim: null });
      }
      if (c.method === "POST" && c.path === BASE) {
        return ++answers === 1 ? reply(409, { code: "seat_moved" }) : reply(200, { case: RESPONDENT.judging, name_map: [] });
      }
      return null;
    };
    await open();
    const box = await screen.findByPlaceholderText(t("en", "respond.placeholder"));
    await waitFor(() => expect(opens).toBe(1));
    fireEvent.change(box, { target: { value: TYPED } });
    const send = () => screen.getByRole("button", { name: t("en", "respond.submit") }) as HTMLButtonElement;
    await waitFor(() => expect(send().disabled).toBe(false));
    await act(async () => {
      fireEvent.click(send());
    });
    await waitFor(() => expect(opens).toBe(2));
    expect(posts(BASE)[0].body).toMatchObject({ party: "b" });
    await waitFor(() => expect(send().disabled).toBe(false));
    expect((screen.getByPlaceholderText(t("en", "respond.placeholder")) as HTMLTextAreaElement).value).toBe(TYPED);
    expect(mainEl().textContent).not.toContain(t("en", "case.loadFailed"));
    expect(gets(BASE)).toHaveLength(1);
    await act(async () => {
      fireEvent.click(send());
    });
    await waitFor(() => expect(posts(BASE)).toHaveLength(2));
    expect(posts(BASE)[1].body).toMatchObject({ party: "c", text: TYPED });
  });
});

const TWO_VERDICTS = [verdictView(TWO_SIDED_RESULT, 1, "v_first"), verdictView(APPEAL_RESULT, 2, "v_second")];

function bystanderJudged(): CaseView {
  return caseView({ ...RESPONDENT.judgedSignedOut, inAccount: false, verdicts: TWO_VERDICTS });
}

function boundJudged(): CaseView {
  return caseView({ ...RESPONDENT.judgedPremium, verdicts: TWO_VERDICTS });
}

describe("RespondScreen, a bystander", () => {
  beforeEach(() => {
    saveCaseNames("case123", "b", RESPONDENT_NAMES);
  });

  function expectNeutral(): void {
    const text = mainEl().textContent ?? "";
    expect(text).not.toContain("(you)");
    expect(text).not.toContain("Aytu");
    expect(text).not.toContain("Sarah");
    expect(text).not.toContain(t("en", "respond.sent"));
    expect(text).not.toContain(t("en", "appeal.title"));
    expect(text).not.toContain(t("en", "respond.remove"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(t("en", "respond.inviteTitle"));
    expect(mainEl().getAttribute("data-you")).toBeNull();
    expect(mainEl().querySelector("[data-you='b']")).toBeNull();
  }

  it("on a judging case: no side of theirs, a neutral invite page", async () => {
    route = (c) => (c.path === BASE ? reply(200, { case: caseView({ ...RESPONDENT.judging, inAccount: false }) }) : null);
    await open();
    await screen.findByText(t("en", "respond.closed"));
    expectNeutral();
  });

  it("on a judged case: the verdicts read neutrally, earlier ones too", async () => {
    route = (c) => (c.path === BASE ? reply(200, { case: bystanderJudged() }) : null);
    await open();
    await screen.findByText(t("en", "appeal.history"));
    expect(mainEl().querySelector("details")).not.toBeNull();
    expectNeutral();
    expect(posts(`${BASE}/open`)).toHaveLength(0);
  });
});

describe("RespondScreen, the bound account", () => {
  it("on a judged case with one verdict: the appeal form is theirs", async () => {
    route = (c) => (c.path === BASE ? reply(200, { case: RESPONDENT.judgedPremium }) : null);
    await open();
    await screen.findAllByText("Party B (you)");
    expect(mainEl().textContent).toContain(t("en", "appeal.title"));
  });

  it("on a judged case: its own view with names, labels, appeal and removal", async () => {
    saveCaseNames("case123", "b", RESPONDENT_NAMES);
    route = (c) => (c.path === BASE ? reply(200, { case: boundJudged() }) : null);
    await open();
    expect((await screen.findAllByText("Party B (you)")).length).toBeGreaterThan(0);
    const text = mainEl().textContent ?? "";
    expect(text).toContain("Aytu");
    expect(text).toContain(t("en", "respond.remove"));
    expect(text).toContain(t("en", "appeal.history"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(t("en", "case.title"));
    expect(mainEl().getAttribute("data-you")).toBe("b");
    expect(mainEl().querySelector("details")?.textContent).toContain("(you)");
  });
});
