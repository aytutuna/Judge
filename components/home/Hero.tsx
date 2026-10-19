"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { FrameworkPicker } from "@/components/FrameworkPicker";
import { getPreset } from "@/lib/frameworks";
import { setJudgingFrame } from "@/lib/scene-bridge";
import { JUDGING_CARD_TOP } from "@/lib/scene-layout";
import { t, type Key, type Lang } from "@/lib/i18n";
import { noOrphan, separatorPhrases } from "@/lib/text";
import type { FrameworkChoice } from "@/lib/types";
import styles from "./Hero.module.css";

export type HeroPhase = "intake" | "judging" | "verdict";

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

export type HeroProps = {
  lang: Lang;
  phase: HeroPhase;
  argument: string;
  onArgumentChange: (value: string) => void;
  /** `key` is the example's text key; `index` its position in EXAMPLES. */
  onExample: (key: Key, index: number) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  error: string | null;
  framework: FrameworkChoice;
  onFrameworkChange: (next: FrameworkChoice) => void;
  /** Rendered only while the form is shown, so tokens are always fresh. */
  turnstile: ReactNode;
  /** Shown over the hidden form while a request is pending. */
  judging: ReactNode;
  /** Replaces the form card once the verdict is in. */
  verdict: ReactNode;
};

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The homepage hero: eyebrow, two-line title, lead, and one glass card that
 * holds the form, then the judging overlay (stacked in the same grid cell,
 * so the card keeps its height), then gives way to the verdict.
 *
 * The text block carries `data-scene-avoid`: the 3D stage fades out where
 * the balance would overlap it on narrow screens.
 */
export function Hero({
  lang,
  phase,
  argument,
  onArgumentChange,
  onExample,
  onSubmit,
  canSubmit,
  error,
  framework,
  onFrameworkChange,
  turnstile,
  judging,
  verdict,
}: HeroProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const verdictRef = useRef<HTMLDivElement>(null);
  const prevPhase = useRef<HeroPhase>(phase);

  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = phase;
    if (prev === phase) return;

    if (phase === "judging") {
      // Bring the card into view: the whole hero on desktop, or just under
      // the judging band of the scene on mobile.
      const card = cardRef.current;
      if (!card) return;
      const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
      if (window.matchMedia("(min-width: 960px)").matches) {
        window.scrollTo({ top: 0, behavior });
      } else {
        const top = card.getBoundingClientRect().top + window.scrollY - window.innerHeight * JUDGING_CARD_TOP;
        window.scrollTo({ top: Math.max(0, top), behavior });
      }
    } else if (phase === "verdict") {
      // A screen reader reads the verdict heading next, not stale captions.
      verdictRef.current?.focus({ preventScroll: true });
    } else if (prev === "verdict") {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [phase]);

  // The scene frames itself around the judging card while it shows.
  useEffect(() => {
    setJudgingFrame(phase === "judging");
    return () => setJudgingFrame(false);
  }, [phase]);

  const isJudging = phase === "judging";
  const preset = getPreset(framework.preset);
  const presetLabel = `${preset.emoji} ${t(lang, `preset.${preset.id}.label`)}`;

  return (
    <section className={styles.hero} aria-labelledby="hero-title" data-phase={phase}>
      <div className="wrap">
        <div className={styles.col}>
          <div className={styles.text} data-scene-avoid="">
            <p className={styles.eyebrow}>
              <span className={styles.pips} aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <span>
                {separatorPhrases(t(lang, "hero.eyebrow")).map((phrase, i) => (
                  <Fragment key={phrase}>
                    {i > 0 ? " " : null}
                    <span className={styles.phrase}>{phrase}</span>
                  </Fragment>
                ))}
              </span>
            </p>
            <h1 id="hero-title" className={styles.title}>
              <span className={styles.line1}>{noOrphan(t(lang, "hero.titleLine1"))}</span>{" "}
              <em>{noOrphan(t(lang, "hero.titleLine2"))}</em>
            </h1>
            {phase === "verdict" ? null : <p className={styles.lead}>{t(lang, "hero.lead")}</p>}
          </div>

          {phase === "verdict" ? (
            <div ref={verdictRef} tabIndex={-1} className={styles.verdict}>
              {verdict}
            </div>
          ) : (
            <div ref={cardRef} className={styles.card}>
              <form
                className={styles.form}
                inert={isJudging}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canSubmit) onSubmit();
                }}
              >
                <label className={styles.fieldLabel} htmlFor="argument">
                  <span>{t(lang, "input.label")}</span>
                  <span className={styles.count} aria-hidden>
                    {argument.length} / {MAX_ARGUMENT}
                  </span>
                </label>
                <textarea
                  id="argument"
                  ref={inputRef}
                  className={styles.textarea}
                  value={argument}
                  onChange={(e) => onArgumentChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={t(lang, "placeholder")}
                  rows={4}
                  maxLength={MAX_ARGUMENT}
                  required
                  minLength={20}
                  aria-describedby={error ? "hero-error" : undefined}
                />

                <p className={styles.spark} id="hero-spark">
                  {t(lang, "examples.label")}
                </p>
                <div className={styles.chips} role="group" aria-labelledby="hero-spark">
                  {EXAMPLES.map((ex, i) => (
                    <button
                      key={ex.text}
                      type="button"
                      className={styles.chip}
                      data-on={argument === t(lang, ex.text) ? "" : undefined}
                      onClick={() => {
                        onExample(ex.text, i);
                        inputRef.current?.focus({ preventScroll: true });
                      }}
                    >
                      {t(lang, ex.label)}
                    </button>
                  ))}
                </div>


                {phase === "intake" && turnstile ? (
                  <div className={styles.turnstile}>{turnstile}</div>
                ) : null}

                {error ? (
                  <p className={styles.error} id="hero-error" role="alert">
                    <svg viewBox="0 0 16 16" aria-hidden>
                      <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M8 4.6v4.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      <circle cx="8" cy="11.3" r="0.95" fill="currentColor" />
                    </svg>
                    <span>{error}</span>
                  </p>
                ) : null}

                <div className={styles.ctaRow}>
                  <button type="submit" className={styles.cta} disabled={!canSubmit}>
                    <svg className={styles.ctaIcon} viewBox="0 0 20 20" aria-hidden>
                      <path d="M3 8.5 17 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      <circle cx="5" cy="5.6" r="2.4" fill="#E59A86" />
                      <circle cx="15" cy="3.8" r="2.4" fill="#B5CCC0" />
                      <path d="M10 8 7.6 16h4.8z" fill="currentColor" />
                    </svg>
                    <span>{t(lang, "getVerdict")}</span>
                    <span className={styles.arrow} aria-hidden>
                      →
                    </span>
                  </button>
                </div>

                <details className={styles.advanced}>
                  <summary className={styles.summary}>
                    <span className={styles.summaryText}>
                      <svg className={styles.caret} viewBox="0 0 12 12" aria-hidden>
                        <path
                          d="M4.5 2.5 8 6l-3.5 3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {t(lang, "advanced.summary")}
                    </span>
                    <span className={styles.current}>
                      {t(lang, "advanced.current", { label: presetLabel })}
                    </span>
                  </summary>
                  <div className={styles.advancedBody}>
                    <FrameworkPicker value={framework} onChange={onFrameworkChange} />
                  </div>
                </details>

                <p className={styles.privacy}>
                  <svg viewBox="0 0 16 16" aria-hidden>
                    <rect x="3" y="7" width="10" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                  <span>
                    {t(lang, "privacyNote")}{" "}
                    <Link href="/privacy" className={styles.privacyLink}>
                      {t(lang, "privacyLink")}
                    </Link>
                  </span>
                </p>
              </form>

              {isJudging ? <div className={styles.judging}>{judging}</div> : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
