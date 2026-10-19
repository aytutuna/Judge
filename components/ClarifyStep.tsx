"use client";

import { useEffect, useRef } from "react";
import { t, type Lang } from "@/lib/i18n";
import type { Clarification, ClarifyResponse } from "@/lib/types";
import { PremiumSpark } from "./PremiumBadge";
import styles from "./ClarifyStep.module.css";

export type ClarifyQuestion = ClarifyResponse["questions"][number];

/** Longest answer the API accepts (lib/types.ts Clarification). */
export const MAX_ANSWER = 500;

/** The request's `clarifications`: one entry per question, answered or not
 * (the server drops empty answers). `skip` sends every answer empty, so a
 * skipped step costs nothing and still tells the server what was asked.
 * Undefined when there were no questions, which keeps the body minimal. */
export function buildClarifications(
  questions: readonly ClarifyQuestion[],
  answers: Readonly<Record<string, string>>,
  skip: boolean,
): Clarification[] | undefined {
  if (questions.length === 0) return undefined;
  return questions.slice(0, 2).map((q) => ({
    question: q.text.trim().slice(0, 300),
    answer: skip ? "" : (answers[q.id] ?? "").trim().slice(0, MAX_ANSWER),
  }));
}

/**
 * Premium's clarifying step, shown in the hero card in place of the form:
 * up to two short questions, each with an optional answer, then "Get the
 * verdict" or "Skip and judge". The heading takes focus on mount so a
 * screen reader lands on the step rather than on the vanished form.
 */
export function ClarifyStep({
  lang,
  questions,
  answers,
  onAnswer,
  onSubmit,
  onSkip,
  onBack,
}: {
  lang: Lang;
  questions: readonly ClarifyQuestion[];
  answers: Readonly<Record<string, string>>;
  onAnswer: (id: string, value: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <form
      className={styles.root}
      aria-labelledby="clarify-title"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <p className={styles.eyebrow}>
        <PremiumSpark className={styles.spark} />
        {t(lang, "tier.premium")}
      </p>
      <h2 id="clarify-title" ref={headingRef} tabIndex={-1} className={styles.title}>
        {t(lang, "clarify.title")}
      </h2>
      <p className={styles.lead}>{t(lang, "clarify.lead")}</p>

      <ol className={styles.questions}>
        {questions.map((q, i) => (
          <li key={q.id} className={styles.question}>
            <label htmlFor={`clarify-${q.id}`} className={styles.label}>
              <span className="sr-only">{t(lang, "clarify.answerAria", { n: i + 1 })} </span>
              {q.text}
            </label>
            <textarea
              id={`clarify-${q.id}`}
              className={styles.answer}
              rows={2}
              maxLength={MAX_ANSWER}
              value={answers[q.id] ?? ""}
              placeholder={t(lang, "clarify.placeholder")}
              onChange={(e) => onAnswer(q.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </li>
        ))}
      </ol>

      <div className={styles.actions}>
        <button type="submit" className={styles.primary}>
          {t(lang, "clarify.submit")}
          <span aria-hidden>→</span>
        </button>
        <button type="button" className={styles.secondary} onClick={onSkip}>
          {t(lang, "clarify.skip")}
        </button>
      </div>
      <button type="button" className={styles.back} onClick={onBack}>
        <span aria-hidden>←</span> {t(lang, "clarify.back")}
      </button>
    </form>
  );
}
