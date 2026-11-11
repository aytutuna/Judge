import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CasePanel, ownSideText } from "../components/case/CaseScreen";
import type { AppealDraft } from "../components/case/AppealForm";
import { Balance } from "../components/home/Balance";
import { NextSteps } from "../components/shell/NextSteps";
import { Thread } from "../components/thread/Thread";
import { t } from "../lib/i18n";
import type { VerdictResult } from "../lib/types";
import { confidenceLabel, judgesLabel } from "../lib/verdict-display";
import { OWNER, OWNER_NAMES } from "./ui-case-fixtures";

const noop = () => {};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

/** The data-turn and data-part markers, in document order. */
const order = (html: string) => [...html.matchAll(/data-(?:turn|part)="([a-zA-Z]+)"/g)].map((m) => m[1]);

describe("Thread", () => {
  it("free verdict: the argument as written, then the judges' verdict", () => {
    const html = renderToStaticMarkup(
      <Thread lang="en" argument={"Sam says a hot dog\nis a sandwich."} verdict={<div data-testid="verdict" />} />,
    );
    expect(order(html)).toEqual(["argument", "judges", "verdict"]);
    expect(html).toContain("Sam says a hot dog\nis a sandwich.");
    expect(html).toContain(t("en", "thread.judges"));
    expect(html).toContain('data-testid="verdict"');
    // The verdict takes focus once it replaces the judging card.
    expect(html).toMatch(/data-part="verdict"[^>]*tabindex="-1"/);
    expect(html).toContain(`aria-label="${t("en", "thread.label")}"`);
  });

  it("judging: the progress line comes before the judging card", () => {
    const html = renderToStaticMarkup(
      <Thread lang="en" argument="An argument." judging={<div data-testid="judging" />} status="Checking" />,
    );
    expect(order(html)).toEqual(["argument", "judges", "status", "judging"]);
    expect(html).not.toContain('role="status"');
  });

  it("clarify: the questions answer the argument, with no verdict yet", () => {
    const html = renderToStaticMarkup(
      <Thread lang="tr" argument="Bir tartışma." clarify={<form data-testid="clarify" />} />,
    );
    expect(order(html)).toEqual(["argument", "judges", "clarify"]);
    expect(html).toContain(t("tr", "thread.judges"));
    expect(html).not.toContain('data-part="verdict"');
  });

  it("always places the parts in thread order, whatever order they are given in", () => {
    const html = renderToStaticMarkup(
      <Thread
        lang="en"
        argument="x"
        followUp={<p>next</p>}
        verdict={<p>v</p>}
        notice={<p>n</p>}
        invite={<p>i</p>}
      />,
    );
    expect(order(html)).toEqual(["argument", "judges", "invite", "notice", "verdict", "followUp"]);
  });

  it("says so when the text was not kept, and has no judges' turn without parts", () => {
    const html = renderToStaticMarkup(<Thread lang="en" argument={null} />);
    expect(html).toContain(esc(t("en", "owner.notStored")));
    expect(order(html)).toEqual(["argument"]);
    const unreadable = renderToStaticMarkup(<Thread lang="en" argument={null} missing="owner.unreadable" />);
    expect(unreadable).toContain(esc(t("en", "owner.unreadable")));
    expect(unreadable).not.toContain(esc(t("en", "owner.notStored")));
  });
});

describe("case page as a thread", () => {
  const draft: AppealDraft = {
    text: "",
    setText: noop,
    evidence: { items: [], tokens: [], busy: false, full: false, failure: null, overLimit: false, add: noop, remove: noop, clear: noop },
    sending: false,
    error: null,
    canSubmit: false,
    submit: async () => {},
  };
  const panel = (over: Partial<Parameters<typeof CasePanel>[0]> = {}) =>
    renderToStaticMarkup(
      <CasePanel
        lang="en"
        view={OWNER.awaiting}
        names={OWNER_NAMES}
        overlay={null}
        onOverlayFinished={noop}
        fresh={false}
        busy={false}
        actionError={null}
        resetDone={false}
        onJudgeNow={noop}
        onRetry={noop}
        onShare={noop}
      onReset={noop}
        onRemove={noop}
        appeal={draft}
        {...over}
      />,
    );

  it("waiting: the owner's side, then who is where, then New argument", () => {
    const html = panel();
    expect(order(html)).toEqual(["argument", "judges", "invite"]);
    expect(html.indexOf("Deniz&#x27;s turn")).toBeLessThan(html.indexOf(t("en", "case.invite.share")));
    expect(html).toContain(`href="/">`);
    expect(html).toContain(t("en", "shell.new"));
  });

  it("prefers the side as written once it is loaded", () => {
    expect(panel({ ownText: "Deniz never paid." })).toContain("Deniz never paid.");
  });

  it("judged: the verdict, then the appeal, with Add context in the next steps", () => {
    const html = panel({ view: OWNER.judged });
    expect(order(html)).toEqual(["argument", "judges", "verdict", "followUp"]);
    expect(html.split(t("en", "appeal.title")).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("restores every name but the narrator's in the owner's side", () => {
    const side = OWNER.awaiting.sides[0].text;
    expect(ownSideText(side, OWNER_NAMES)).toBe(
      "Party A: It was Deniz's turn to pay the electricity bill this month. Deniz says they paid, but I never saw it.",
    );
    expect(ownSideText("Taraf A, Taraf B'ye söyledi.", [{ original: "Deniz", replacement: "Party B" }])).toBe(
      "Taraf A, Deniz'e söyledi.",
    );
  });
});

describe("NextSteps", () => {
  it("resets the page in place when it can, else links home", () => {
    const reset = renderToStaticMarkup(<NextSteps lang="tr" onNew={noop} />);
    expect(reset).toContain('<button type="button">');
    expect(reset).toContain(t("tr", "shell.new"));
    expect(renderToStaticMarkup(<NextSteps lang="en" />)).toContain('href="/"');
  });
});

describe("Balance", () => {
  const base = { canUsePremium: true, blockedReason: null, credits: 0, subscription: null, resetsAt: null };
  const sub = { source: "app_store" as const, productId: "monthly", periodStart: "", periodEnd: "", willRenew: true };
  const html = (e: typeof base | Record<string, unknown>) =>
    renderToStaticMarkup(<Balance lang="en" entitlement={{ ...base, ...e }} />);

  it("counts credits, or what is left of the month first", () => {
    expect(html({ credits: 1 })).toBe("1 verdict left");
    expect(html({ credits: 4 })).toBe("4 verdicts left");
    expect(html({ credits: 4, subscription: { ...sub, used: 5, cap: 35 } })).toBe("30 of 35 left this month");
  });

  it("links to pricing with nothing left", () => {
    const out = html({ canUsePremium: false, blockedReason: "no_credits" });
    expect(out).toContain(t("en", "home.out"));
    expect(out).toContain('href="/pricing"');
    expect(html({ canUsePremium: false, blockedReason: "fair_use", subscription: { ...sub, used: 35, cap: 35 } })).toContain(
      'href="/pricing"',
    );
  });
});

describe("judges label", () => {
  const result = (verdict: VerdictResult["verdict"], runs: VerdictResult["runs"]) =>
    ({ verdict, runs }) as VerdictResult;

  it("counts the judges who reached the verdict, and says split when there is none", () => {
    expect(judgesLabel("en", result("side_b", ["side_b", "side_a", "side_b"]))).toBe("Judges · 2 of 3 agree");
    expect(judgesLabel("tr", result("side_a", ["side_a", "side_a", "side_a"]))).toBe(
      t("tr", "thread.judgesAgree", { n: 3, total: 3 }),
    );
    expect(judgesLabel("en", result("too_close", ["side_a", "side_b", "split"]))).toBe("Judges · split");
    expect(judgesLabel("en", result("split", ["split", "split", "side_a"]))).toBe("Judges · 2 of 3 agree");
    expect(judgesLabel("en", result("side_a", []))).toBe(t("en", "thread.judges"));
    expect(judgesLabel("en", null)).toBe(t("en", "thread.judges"));
  });

  it("shows confidence on the panel's own scale", () => {
    expect(confidenceLabel("en", result("side_a", ["side_a", "side_a", "side_a"]))).toBe("Confidence 3 of 3");
    expect(confidenceLabel("en", result("side_b", ["side_b", "side_b", "side_a", "side_b", "side_b"]))).toBe(
      "Confidence 4 of 5",
    );
    expect(confidenceLabel("tr", result("side_b", ["side_b", "side_a", "side_b"]))).toBe("Güven: 3 üzerinden 2");
    expect(confidenceLabel("en", result("too_close", ["side_a", "side_b", "split"]))).toBe("Judges split");
    expect(confidenceLabel("en", result("side_a", []))).toBeNull();
  });

  it("replaces the judges' name in the thread", () => {
    const html = renderToStaticMarkup(
      <Thread lang="en" argument="x" judgesLabel="Judges · 2 of 3 agree" verdict={<p>v</p>} />,
    );
    expect(html).toContain("Judges · 2 of 3 agree");
    expect(html).not.toContain(`${t("en", "thread.judges")}<`);
  });
});
