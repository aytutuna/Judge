import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClarifyStep, MAX_ANSWER, buildClarifications } from "../components/ClarifyStep";
import { DEFAULT_FRAMEWORK } from "../lib/frameworks";
import { Hero, type HeroProps } from "../components/home/Hero";
import { t } from "../lib/i18n";
import { Clarification } from "../lib/types";

const noop = () => {};
const QUESTIONS = [
  { id: "q1", text: "Did B agree to split the bill beforehand?" },
  { id: "q2", text: "Was the booking made in A's name?" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

describe("buildClarifications", () => {
  it("pairs each question with its trimmed answer", () => {
    const out = buildClarifications(QUESTIONS, { q1: "  Yes, by text  " }, false);
    expect(out).toEqual([
      { question: QUESTIONS[0].text, answer: "Yes, by text" },
      { question: QUESTIONS[1].text, answer: "" },
    ]);
    for (const c of out ?? []) expect(Clarification.safeParse(c).success).toBe(true);
  });

  it("skip sends every answer empty, even ones already typed", () => {
    const out = buildClarifications(QUESTIONS, { q1: "Yes", q2: "No" }, true);
    expect(out?.map((c) => c.answer)).toEqual(["", ""]);
  });

  it("no questions means no clarifications field at all", () => {
    expect(buildClarifications([], {}, false)).toBeUndefined();
  });

  it("caps answers at the API limit and never sends more than two", () => {
    const long = "x".repeat(MAX_ANSWER + 50);
    const out = buildClarifications([...QUESTIONS, { id: "q3", text: "Third?" }], { q1: long }, false);
    expect(out).toHaveLength(2);
    expect(out?.[0].answer).toHaveLength(MAX_ANSWER);
  });
});

describe("ClarifyStep", () => {
  const render = (lang: "en" | "tr" = "en") =>
    renderToStaticMarkup(
      <ClarifyStep
        lang={lang}
        questions={QUESTIONS}
        answers={{ q1: "Yes" }}
        onAnswer={noop}
        onSubmit={noop}
        onSkip={noop}
        onBack={noop}
      />,
    );

  it("labels every answer field with its question", () => {
    const html = render();
    for (const q of QUESTIONS) {
      expect(html).toContain(`for="clarify-${q.id}"`);
      expect(html).toContain(`id="clarify-${q.id}"`);
      expect(html).toContain(esc(q.text));
    }
    expect(html).toContain("Answer to question 1:");
    expect(html).toContain(`maxLength="${MAX_ANSWER}"`);
    expect(html).toContain(">Yes</textarea>");
  });

  it("offers answer-and-judge, skip, and back", () => {
    const html = render("tr");
    expect(html).toMatch(/<button type="submit"[^>]*>Kararı öğren/);
    expect(html).toContain(t("tr", "clarify.skip"));
    expect(html).toContain(t("tr", "clarify.back"));
    expect(html).toContain('id="clarify-title"');
    expect(html).toContain('tabindex="-1"');
  });
});

function hero(over: Partial<HeroProps>): string {
  const props: HeroProps = {
    lang: "en",
    phase: "intake",
    argument: "",
    onArgumentChange: noop,
    onExample: noop,
    onSubmit: noop,
    canSubmit: true,
    error: null,
    framework: DEFAULT_FRAMEWORK,
    onFrameworkChange: noop,
    turnstile: null,
    judging: <div data-testid="judging" />,
    verdict: <div data-testid="verdict" />,
    ...over,
  };
  return renderToStaticMarkup(<Hero {...props} />);
}

describe("Hero premium slots", () => {
  it("without a switch, renders no status region and no clarify layer", () => {
    const html = hero({ clarify: <div data-testid="clarify" /> });
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('data-testid="clarify"');
  });

  it("hides the example chips in two-sided mode only", () => {
    expect(hero({})).toContain('id="hero-spark"');
    const both = hero({ twoSided: true });
    expect(both).not.toContain('id="hero-spark"');
    expect(both).not.toContain('aria-labelledby="hero-spark"');
  });

  it("puts the switch before the Premium extras and the CTA, and a polite status line under the CTA", () => {
    const html = hero({
      tierSwitch: <div data-testid="switch" />,
      extras: <div data-testid="mode" />,
      status: "Checking if anything's missing…",
    });
    expect(html.indexOf('data-testid="switch"')).toBeLessThan(html.indexOf('data-testid="mode"'));
    expect(html.indexOf('data-testid="mode"')).toBeLessThan(html.indexOf('type="submit"'));
    expect(html).toMatch(/role="status" aria-live="polite">.*Checking if anything&#x27;s missing…<\/p>/);
  });

  it("clarify phase: the form stays mounted but hidden, the step shows in the card", () => {
    const html = hero({ phase: "clarify", clarify: <div data-testid="clarify" />, tierSwitch: <i /> });
    expect(html).toMatch(/<form[^>]*hidden=""/);
    expect(html).toContain('data-testid="clarify"');
    expect(html).toContain('data-phase="clarify"');
    expect(html).not.toContain('data-testid="judging"');
  });
});
