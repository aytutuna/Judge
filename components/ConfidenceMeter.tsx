import type { CSSProperties } from "react";
import { t, type Lang } from "@/lib/i18n";
import styles from "./verdict/verdict.module.css";

/** One ink bar per judge, filled for each one that voted the verdict, plus
 * "Confidence 3 of 3". The bars fill in sequence when an enclosing verdict
 * card animates. */
export function ConfidenceMeter({ n, total, lang = "en" }: { n: number; total: number; lang?: Lang }) {
  const text = t(lang, "confidence", { n, total });
  return (
    <div className={styles.meter}>
      <div
        className={styles.bars}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={n}
        aria-label={text}
      >
        {Array.from({ length: total }, (_, i) => (
          <i
            key={i}
            aria-hidden
            className={i < n ? `${styles.bar} ${styles.barOn}` : styles.bar}
            style={{ "--i": i } as CSSProperties}
          />
        ))}
      </div>
      <p className={styles.meterText}>{text}</p>
    </div>
  );
}
