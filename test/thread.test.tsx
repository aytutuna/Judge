import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CasePanel, ownSideText } from "../components/case/CaseScreen";
import type { AppealDraft } from "../components/case/AppealForm";
import { Composer, EXAMPLES, MAX_ARGUMENT, NextSteps, type ComposerProps } from "../components/thread/Composer";
import { Recent, recentCards } from "../components/home/Recent";
import type { HistoryItem } from "../components/shell/useHistory";
import { Thread } from "../components/thread/Thread";
import { DEFAULT_FRAMEWORK } from "../lib/frameworks";
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
        onReset={noop}
        onRemove={noop}
        appeal={draft}
        {...over}
      />,
    );

  it("waiting: the owner's side, then the invite link, and no docked bar", () => {
    const html = panel();
    expect(order(html)).toEqual(["argument", "judges", "invite"]);
    expect(html.indexOf("Deniz&#x27;s turn")).toBeLessThan(html.indexOf(OWNER.awaiting.inviteUrl as string));
    expect(html).not.toContain(t("en", "shell.new"));
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

function composer(over: Partial<ComposerProps> = {}): string {
  const props: ComposerProps = {
    lang: "en",
    value: "",
    onChange: noop,
    onSubmit: noop,
    canSubmit: false,
    framework: DEFAULT_FRAMEWORK,
    onFrameworkChange: noop,
    expanded: false,
    onExpandedChange: noop,
    submitLabel: t("en", "getVerdict"),
    tierSwitch: <div data-testid="tier" />,
    extras: <div data-testid="extras" />,
    ...over,
  };
  return renderToStaticMarkup(<Composer {...props} />);
}

describe("Composer", () => {
  it("idle: the box and one toolbar row, the options folded away", () => {
    const html = composer();
    expect(html).toContain('id="argument"');
    expect(html).toContain('rows="2"');
    expect(html).toContain(`placeholder="${esc(t("en", "thread.placeholder"))}"`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-testid="tier"');
    expect(html).not.toContain('data-testid="extras"');
    expect(html).not.toContain("aria-pressed");
    expect(html).toMatch(/type="submit"[^>]*disabled/);
    expect(html).toContain(`aria-label="${t("en", "getVerdict")}"`);
  });

  it("expanded: the framework presets and the extras in a panel the button controls", () => {
    const html = composer({ expanded: true });
    expect(html).toContain('aria-expanded="true"');
    const panel = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(panel).toBeTruthy();
    expect(html).toContain(`id="${panel}"`);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-testid="extras"');
    expect(html).toContain(t("en", "judgeBy"));
  });

  it("sends once submittable", () => {
    expect(composer({ canSubmit: true })).not.toMatch(/type="submit"[^>]*disabled/);
  });

  it("is held while judging, even with a sendable text", () => {
    const html = composer({ canSubmit: true, disabled: true, value: "x".repeat(40) });
    expect(html).toMatch(/<fieldset[^>]*disabled/);
    expect(html).toMatch(/type="submit"[^>]*disabled/);
  });

  it("ties the error to the box and shows Turnstile and the examples when given", () => {
    const html = composer({ error: "Slow down", turnstile: <div data-testid="turnstile" />, onExample: noop });
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-describedby="composer-error"');
    expect(html).toContain('data-testid="turnstile"');
    expect(html).toContain(esc(t("en", "examples.label")));
  });

  it("flags the example already in the box and shows a literal, aria-hidden count near the cap", () => {
    const html = composer({ value: t("en", EXAMPLES[1].text), onExample: noop });
    expect(html.split("data-on").length - 1).toBe(1);
    expect(composer({ value: "x".repeat(MAX_ARGUMENT - 10) })).toMatch(
      new RegExp(`aria-hidden="true">${MAX_ARGUMENT - 10} / ${MAX_ARGUMENT}<`),
    );
  });

  it("both sides: says so in the toolbar and offers no examples", () => {
    const html = composer({ twoSided: true, onExample: noop, submitLabel: t("en", "case.create") });
    expect(html).toContain(t("en", "case.kicker"));
    expect(html).toContain(esc(t("en", "thread.placeholderTwoSided")));
    expect(html).not.toContain(esc(t("en", "examples.label")));
  });
});

describe("NextSteps", () => {
  it("docks the thread's follow-ups and nothing else", () => {
    const html = renderToStaticMarkup(
      <NextSteps>
        <button type="button">Appeal</button>
      </NextSteps>,
    );
    expect(html).toContain('<button type="button">Appeal</button>');
    expect(html).not.toContain(t("en", "shell.new"));
    expect(renderToStaticMarkup(<NextSteps>{null}</NextSteps>)).toBe("");
  });
});

describe("Composer as the empty page's case file", () => {
  it("holds the page heading, the steps and a full-width send", () => {
    const html = composer({ card: true, onExample: noop });
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(t("en", "home.title"));
    expect(html).toContain(t("en", "home.kicker"));
    for (const key of ["home.step.argument", "thread.lens", "home.step.ruling"] as const) {
      expect(html).toContain(t("en", key));
    }
    expect(html.split('aria-current="step"').length - 1).toBe(1);
    // One send button, labelled by its text and held until there is enough to send.
    expect(html.split('type="submit"').length - 1).toBe(1);
    expect(html).toMatch(new RegExp(`type="submit"[^>]*disabled[^>]*>${t("en", "getVerdict")}<svg`));
    expect(html).not.toContain(`aria-label="${t("en", "getVerdict")}"`);
    // The chips sit inside the card, under the field.
    expect(html.indexOf('role="group"')).toBeGreaterThan(html.indexOf('id="argument"'));
    expect(html.indexOf('role="group"')).toBeLessThan(html.indexOf("</fieldset>"));
  });

  it("offers both sides from a link, and one side back once switched", () => {
    expect(composer({ card: true })).not.toContain(esc(t("en", "home.invite")));
    const one = composer({ card: true, onSwitchSides: noop });
    expect(one).toMatch(new RegExp(`<button type="button"[^>]*>${esc(t("en", "home.invite"))}</button>`));
    const both = composer({ card: true, twoSided: true, onSwitchSides: noop, submitLabel: t("en", "case.create") });
    expect(both).toContain(t("en", "home.oneSide"));
    expect(both).not.toContain(esc(t("en", "home.invite")));
    expect(both).toContain(t("en", "case.kicker"));
    expect(composer({ card: true, onSwitchSides: noop, lang: "tr" })).toContain(t("tr", "home.invite"));
  });

  it("names the options button as the lens, with the preset", () => {
    const html = composer({ card: true });
    expect(html).toContain(`>${t("en", "thread.lens")}<`);
    expect(html).toContain(t("en", "preset.balanced.label"));
  });
});

describe("Recent", () => {
  const now = new Date(2026, 9, 25, 15, 0).getTime();
  const item = (over: Partial<HistoryItem>): HistoryItem => ({
    kind: "verdict",
    id: "v1",
    createdAt: new Date(2026, 9, 25, 9, 0).toISOString(),
    title: "Sam is right",
    status: null,
    removed: false,
    pending: false,
    ...over,
  });

  it("turns the history into cards: decided, waiting, untitled, removed left out", () => {
    const cards = recentCards(
      "en",
      [
        item({}),
        item({ id: "v2", title: null, pending: true }),
        item({ id: "v3", removed: true, title: null }),
        item({ kind: "case", id: "c1", title: null, status: "awaiting_respondent", createdAt: new Date(2026, 9, 20).toISOString() }),
      ],
      now,
    );
    expect(cards.map((c) => c.href)).toEqual(["/v/v1", null, "/c/c1"]);
    expect(cards.map((c) => c.tone)).toEqual(["decided", "waiting", "waiting"]);
    expect(cards[0]).toMatchObject({ kicker: t("en", "home.decided"), title: "Sam is right", date: t("en", "shell.today") });
    expect(cards[1]).toMatchObject({ kicker: t("en", "home.waiting"), title: t("en", "shell.untitled") });
    expect(cards[2].date).toBe("October 20");
    expect(cards[2].title).toContain("October 20");
  });

  it("links each card and the whole list, and shows nothing without history", () => {
    const html = renderToStaticMarkup(<Recent lang="tr" items={[item({})]} now={now} />);
    expect(html).toContain('href="/v/v1"');
    expect(html).toContain('href="/verdicts"');
    expect(html).toContain(t("tr", "home.recent"));
    expect(renderToStaticMarkup(<Recent lang="en" items={[item({ removed: true })]} now={now} />)).toBe("");
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
