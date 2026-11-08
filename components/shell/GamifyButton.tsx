"use client";

import { t, type Lang } from "@/lib/i18n";
import { setGame, useGame } from "@/lib/game";
import styles from "./shell.module.css";

/** Header toggle for the court art; it lights up when on. The label hides on narrow screens. */
export function GamifyButton({ lang }: { lang: Lang }) {
  const on = useGame();
  const label = t(lang, "shell.gamify");
  return (
    <button
      type="button"
      className={styles.gamify}
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => setGame(!on)}
    >
      <svg viewBox="0 0 24 24" aria-hidden>
        <path
          d="M7.5 7h9a4.5 4.5 0 0 1 4.4 5.4l-.6 3A2.8 2.8 0 0 1 15.5 16.7l-.7-1.2H9.2l-.7 1.2a2.8 2.8 0 0 1-4.8-1.3l-.6-3A4.5 4.5 0 0 1 7.5 7ZM8 10v3M6.5 11.5h3M15.5 10.5h.01M17.5 12.5h.01"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={styles.gamifyLabel}>{label}</span>
    </button>
  );
}
