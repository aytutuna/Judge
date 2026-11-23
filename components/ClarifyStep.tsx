"use client";

import { useEffect, useRef, useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import { langDir } from "@/lib/langs";
import type { Clarification, ClarifyResponse } from "@/lib/types";
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

const OTHER = "other";

function submitOnCtrlEnter(e: React.KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  }
}
type Pick = number | typeof OTHER | null;

/** The choice an existing answer stands for: an option's text, else Other. */
function pickOf(q: ClarifyQuestion, answer: string): Pick {
  const i = q.options?.indexOf(answer) ?? -1;
  if (i >= 0) return i;
  return answer ? OTHER : null;
}

/**
 * Premium's clarifying step, shown in the hero card in place of the form:
 * up to two short questions, each answered by tapping one of the likely
 * answers or Other (a text box), or left empty, then "Get the
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
  const rtl = langDir(lang) === "rtl";
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const [picks, setPicks] = useState<Record<string, Pick>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, pickOf(q, answers[q.id] ?? "")])),
  );
  // Typed text stays here while an option is picked, so Other restores it.
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, pickOf(q, answers[q.id] ?? "") === OTHER ? (answers[q.id] ?? "") : ""])),
  );
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (focusId) document.getElementById(`clarify-${focusId}`)?.focus();
  }, [focusId]);

  function choose(q: ClarifyQuestion, pick: Pick) {
    setPicks((p) => ({ ...p, [q.id]: pick }));
    setFocusId(pick === OTHER ? q.id : null);
    onAnswer(q.id, pick === OTHER ? (typed[q.id] ?? "") : pick === null ? "" : (q.options?.[pick] ?? ""));
  }

  return (
    <form
      className={styles.root}
      aria-labelledby="clarify-title"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h2 id="clarify-title" ref={headingRef} tabIndex={-1} className={styles.title}>
        {t(lang, "clarify.title")}
      </h2>
      <p className={styles.lead}>{t(lang, "clarify.lead")}</p>

      <ol className={styles.questions}>
        {questions.map((q, i) => (
          <li key={q.id} className={styles.question}>
            {q.options?.length ? (
              <div role="radiogroup" aria-labelledby={`clarify-${q.id}-q`} className={styles.question}>
                <span id={`clarify-${q.id}-q`} className={styles.label}>
                  <span className="sr-only">{t(lang, "clarify.answerAria", { n: i + 1 })} </span>
                  {q.text}
                </span>
                <div className={styles.choices}>
                  {[...q.options, null].map((text, k) => {
                    const value: Pick = text === null ? OTHER : k;
                    const checked = picks[q.id] === value;
                    return (
                      <label key={k} className={styles.choice}>
                        <input
                          type="radio"
                          name={`clarify-${q.id}-choice`}
                          className={styles.radio}
                          checked={checked}
                          onChange={() => choose(q, value)}
                          onClick={() => checked && choose(q, null)}
                        />
                        <span className={styles.chip}>{text ?? t(lang, "clarify.other")}</span>
                      </label>
                    );
                  })}
                </div>
                {picks[q.id] === OTHER && (
                  <textarea
                    id={`clarify-${q.id}`}
                    className={styles.answer}
                    rows={2}
                    maxLength={MAX_ANSWER}
                    value={typed[q.id] ?? ""}
                    placeholder={t(lang, "clarify.placeholder")}
                    aria-label={`${q.text} ${t(lang, "clarify.other")}`}
                    onChange={(e) => {
                      setTyped((v) => ({ ...v, [q.id]: e.target.value }));
                      onAnswer(q.id, e.target.value);
                    }}
                    onKeyDown={submitOnCtrlEnter}
                  />
                )}
              </div>
            ) : (
              <>
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
                  onKeyDown={submitOnCtrlEnter}
                />
              </>
            )}
          </li>
        ))}
      </ol>

      <div className={styles.actions}>
        <button type="submit" className={styles.primary}>
          {t(lang, "clarify.submit")}
          <span aria-hidden>{rtl ? "←" : "→"}</span>
        </button>
        <button type="button" className={styles.secondary} onClick={onSkip}>
          {t(lang, "clarify.skip")}
        </button>
      </div>
      <button type="button" className={styles.back} onClick={onBack}>
        <span aria-hidden>{rtl ? "→" : "←"}</span> {t(lang, "clarify.back")}
      </button>
    </form>
  );
}
