import Link from "next/link";
import type { ReactNode } from "react";
import { t, type Lang } from "@/lib/i18n";
import styles from "./shell.module.css";

/** "New argument" under a finished thread (resetting the page itself when
 * it can) and the thread's own follow-ups. */
export function NextSteps({ lang, onNew, children }: { lang: Lang; onNew?: () => void; children?: ReactNode }) {
  const plus = (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
  return (
    <div className={styles.dock}>
      <div className={styles.next}>
        {children}
        {onNew ? (
          <button type="button" onClick={onNew}>
            {plus}
            {t(lang, "shell.new")}
          </button>
        ) : (
          <Link href="/">
            {plus}
            {t(lang, "shell.new")}
          </Link>
        )}
      </div>
    </div>
  );
}
