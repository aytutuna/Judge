"use client";

import { useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { getPreset } from "@/lib/frameworks";
import { formatDate, t, type Key, type Lang } from "@/lib/i18n";
import type { FrameworkChoice } from "@/lib/types";
import { FrameworkPicker } from "../FrameworkPicker";
import styles from "./thread.module.css";

/** Longest argument the form accepts (the API enforces the same cap). */
export const MAX_ARGUMENT = 6000;

/** Example chips: the label is shown, the text fills the textarea. */
export const EXAMPLES = [
  { label: "example.hotdog.label", text: "example.hotdog.text" },
  { label: "example.tomato.label", text: "example.tomato.text" },
  { label: "example.whiteLie.label", text: "example.whiteLie.text" },
  { label: "example.knuckles.label", text: "example.knuckles.text" },
  { label: "example.pineapple.label", text: "example.pineapple.text" },
] as const satisfies readonly { label: Key; text: Key }[];

const STEPS = ["home.step.argument", "thread.lens", "home.step.ruling"] as const satisfies readonly Key[];

function subscribeNever(): () => void {
  return () => {};
}

export type ComposerProps = {
  lang: Lang;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  /** An argument is in the thread: nothing changes until it is done. */
  disabled?: boolean;
  error?: string | null;
  framework: FrameworkChoice;
  onFrameworkChange: (next: FrameworkChoice) => void;
  /** The options panel (framework, mode, name, screenshots) is open. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** In the toolbar beside the options button. */
  tierSwitch?: ReactNode;
  /** In the options panel, after the framework. */
  extras?: ReactNode;
  turnstile?: ReactNode;
  twoSided?: boolean;
  submitLabel: string;
  /** Offers the example chips under the textarea. */
  onExample?: (key: Key) => void;
  /** The empty page: the composer is its case-file card, with the page's
   * heading, the steps and a full-width send button. */
  card?: boolean;
  /** Offers the link that switches between one side and both sides. */
  onSwitchSides?: () => void;
};

/** "New case", today's date, the heading and the steps. The date is the
 * viewer's local day, so the server render leaves it out. */
function CaseHead({ lang }: { lang: Lang }) {
  const today = useSyncExternalStore(
    subscribeNever,
    () => formatDate(lang, new Date().toISOString()),
    () => null,
  );
  return (
    <div className={styles.head}>
      <p className={styles.headRow}>
        <span className={styles.kicker}>{t(lang, "home.kicker")}</span>
        <span className={styles.today}>{today}</span>
      </p>
      <h1 className={styles.title}>{t(lang, "home.title")}</h1>
      <ol className={styles.steps}>
        {STEPS.map((key, i) => (
          <li key={key} aria-current={i === 0 ? "step" : undefined}>
            <span className={styles.stepDot} aria-hidden>
              {i + 1}
            </span>
            {t(lang, key)}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The argument box: an auto-growing textarea over one toolbar row (the
 * lens button, Free / Premium, send). Everything else sits in the options
 * panel under that row (after the button in tab order), so the docked box
 * stays two rows tall. As the empty page's `card` it also holds the
 * heading and sends from a full-width button under the toolbar.
 * Ctrl/Cmd+Enter sends, as the old form did: arguments run to several
 * paragraphs.
 */
export function Composer({
  lang,
  value,
  onChange,
  onSubmit,
  canSubmit,
  disabled = false,
  error = null,
  framework,
  onFrameworkChange,
  expanded,
  onExpandedChange,
  tierSwitch,
  extras,
  turnstile,
  twoSided = false,
  submitLabel,
  onExample,
  card = false,
  onSwitchSides,
}: ComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelId = useId();
  const preset = getPreset(framework.preset);
  const ready = canSubmit && !disabled;

  // Grows with the text up to the CSS max-height, then scrolls.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className={styles.dock}>
      {error ? (
        <p className={styles.error} id="composer-error" role="alert">
          {error}
        </p>
      ) : null}
      <form
        className={styles.box}
        data-card={card ? "" : undefined}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onSubmit();
        }}
      >
        {card ? <CaseHead lang={lang} /> : null}
        <fieldset className={styles.hold} disabled={disabled}>
          <label htmlFor="argument" className="sr-only">
            {t(lang, twoSided ? "input.labelTwoSided" : "input.label")}
          </label>
          <textarea
            id="argument"
            ref={inputRef}
            className={styles.input}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={t(lang, twoSided ? "thread.placeholderTwoSided" : "thread.placeholder")}
            rows={2}
            maxLength={MAX_ARGUMENT}
            required
            minLength={20}
            aria-describedby={error ? "composer-error" : undefined}
          />
          {onExample && !twoSided ? (
            <div className={styles.examples} role="group" aria-labelledby="composer-examples">
              <p id="composer-examples" className="sr-only">
                {t(lang, "examples.label")}
              </p>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.text}
                  type="button"
                  className={styles.chip}
                  data-on={value === t(lang, ex.text) ? "" : undefined}
                  onClick={() => {
                    onExample(ex.text);
                    inputRef.current?.focus({ preventScroll: true });
                  }}
                >
                  {t(lang, ex.label)}
                </button>
              ))}
            </div>
          ) : null}
          <div className={styles.toolbar}>
            <button
              type="button"
              className={styles.options}
              aria-expanded={expanded}
              aria-controls={expanded ? panelId : undefined}
              onClick={() => onExpandedChange(!expanded)}
            >
              <span aria-hidden>{preset.emoji}</span>
              <span className={styles.lens}>{t(lang, "thread.lens")}</span>
              <span className={styles.optionsLabel}>
                <span aria-hidden>· </span>
                {t(lang, `preset.${preset.id}.label`)}
              </span>
              <svg className={styles.caret} viewBox="0 0 12 12" aria-hidden>
                <path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            {twoSided ? <span className={styles.mode}>{t(lang, "case.kicker")}</span> : null}
            {tierSwitch ? <div className={styles.tier}>{tierSwitch}</div> : null}
            {value.length > MAX_ARGUMENT - 500 ? (
              <span className={styles.count} aria-hidden>
                {value.length} / {MAX_ARGUMENT}
              </span>
            ) : null}
            {card ? null : (
              <button type="submit" className={styles.send} disabled={!ready} aria-label={submitLabel}>
                <svg viewBox="0 0 20 20" aria-hidden>
                  <path d="M10 16V4M4.5 9.5 10 4l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
          {expanded ? (
            <div id={panelId} className={styles.panel}>
              <FrameworkPicker value={framework} onChange={onFrameworkChange} />
              {extras}
            </div>
          ) : null}
          {card ? (
            <button type="submit" className={styles.submit} disabled={!ready}>
              {submitLabel}
              <svg viewBox="0 0 20 20" aria-hidden>
                <path d="M4 10h12M10.5 4.5 16 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}
          {onSwitchSides ? (
            <button type="button" className={styles.sides} onClick={onSwitchSides}>
              {t(lang, twoSided ? "home.oneSide" : "home.invite")}
            </button>
          ) : null}
        </fieldset>
      </form>
      {turnstile ? <div className={styles.turnstile}>{turnstile}</div> : null}
    </div>
  );
}

/** Where the composer was, once the thread has its verdict: the thread's
 * own follow-ups, if it has any. */
export function NextSteps({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div className={styles.dock}>
      <div className={styles.next}>{children}</div>
    </div>
  );
}
