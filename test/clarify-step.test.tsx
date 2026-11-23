import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClarifyStep, MAX_ANSWER, buildClarifications } from "../components/ClarifyStep";
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

describe("ClarifyStep options", () => {
  const WITH_OPTIONS = [{ id: "q1", text: "Did B agree?", options: ["Yes, by text", "No, never"] }];
  const render = (answers: Record<string, string>, lang: "en" | "ar" = "en") =>
    renderToStaticMarkup(
      <ClarifyStep
        lang={lang}
        questions={WITH_OPTIONS}
        answers={answers}
        onAnswer={noop}
        onSubmit={noop}
        onSkip={noop}
        onBack={noop}
      />,
    );

  it("shows a radio group of the options plus Other, nothing picked, no text box", () => {
    const html = render({});
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-labelledby="clarify-q1-q"');
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).not.toContain("checked");
    expect(html).toContain("Yes, by text");
    expect(html).toContain(`>${t("en", "clarify.other")}</span>`);
    expect(html).not.toContain("<textarea");
  });

  it("checks the option that matches an earlier answer", () => {
    const html = render({ q1: "No, never" });
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/checked=""[^>]*\/><span[^>]*>No, never</);
    expect(html).not.toContain("<textarea");
  });

  it("opens the Other box with an earlier typed answer", () => {
    const html = render({ q1: "Only verbally" });
    expect(html).toContain(">Only verbally</textarea>");
    expect(html).toMatch(/checked=""[^>]*\/><span[^>]*>Other</);
  });

  it("keeps the text box alone for a question without options", () => {
    const html = renderToStaticMarkup(
      <ClarifyStep lang="en" questions={QUESTIONS} answers={{}} onAnswer={noop} onSubmit={noop} onSkip={noop} onBack={noop} />,
    );
    expect(html).not.toContain('type="radio"');
    expect(html.match(/<textarea/g)).toHaveLength(2);
  });

  it("builds the request from the chosen option text", () => {
    const out = buildClarifications(WITH_OPTIONS, { q1: "Yes, by text" }, false);
    expect(out).toEqual([{ question: "Did B agree?", answer: "Yes, by text" }]);
  });
});
