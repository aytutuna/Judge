import type { CSSProperties } from "react";
import { t, type Key, type Lang } from "@/lib/i18n";
import styles from "./verdict/verdict.module.css";

/** Indexed by clamped value - 1 — a typed lookup, no `as Key` cast. */
const CONF_KEY = [
  "confidence.1",
  "confidence.2",
  "confidence.3",
  "confidence.4",
  "confidence.5",
] as const satisfies readonly Key[];

/** Five ink bars plus "High confidence · 4/5". The bars fill in sequence
 * when an enclosing verdict card animates. */
export function ConfidenceMeter({ value, lang = "en" }: { value: number; lang?: Lang }) {
  const v = Math.max(1, Math.min(5, Math.round(value)));
  const word = t(lang, CONF_KEY[v - 1]);
  return (
    <div className={styles.meter}>
      <div
        className={styles.bars}
        role="meter"
        aria-valuemin={1}
        aria-valuemax={5}
        aria-valuenow={v}
        aria-label={t(lang, "confidenceAria", { n: v })}
      >
        {[1, 2, 3, 4, 5].map((i) => (
          <i
            key={i}
            aria-hidden
            className={i <= v ? `${styles.bar} ${styles.barOn}` : styles.bar}
            style={{ "--i": i - 1 } as CSSProperties}
          />
        ))}
      </div>
      <p className={styles.meterText}>{t(lang, "confidenceWord", { word, n: v })}</p>
    </div>
  );
}
