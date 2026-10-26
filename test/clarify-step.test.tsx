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
