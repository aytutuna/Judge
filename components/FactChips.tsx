import { t, type Lang } from "@/lib/i18n";
import { stripLeadingEmoji } from "@/lib/text";
import styles from "./verdict/verdict.module.css";

/** Facts the verdict relies on, each with a sage check, for the reader to
 * go and verify. */
export function FactChips({ facts, lang = "en" }: { facts: string[]; lang?: Lang }) {
  if (!facts.length) return null;
  return (
    <section>
      <h3 className={styles.sectionTitle}>{stripLeadingEmoji(t(lang, "factsTitle"))}</h3>
      <ul className={styles.factList}>
        {facts.map((f, i) => (
          <li key={i} className={styles.fact}>
            <span className={styles.factCheck} aria-hidden>
              <svg viewBox="0 0 10 10">
                <path
                  d="M2 5.3 4.1 7.3 8 2.9"
                  fill="none"
                  stroke="var(--paper)"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
