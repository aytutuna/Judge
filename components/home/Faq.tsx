import { t, type Key, type Lang } from "@/lib/i18n";
import { noOrphan } from "@/lib/text";
import styles from "./Faq.module.css";

export const FAQ_ITEMS = [
  { q: "faq.fair.q", a: "faq.fair.a" },
  { q: "faq.private.q", a: "faq.private.a" },
  { q: "faq.powers.q", a: "faq.powers.a" },
  { q: "faq.taste.q", a: "faq.taste.a" },
  { q: "faq.legal.q", a: "faq.legal.a" },
] as const satisfies readonly { q: Key; a: Key }[];

/**
 * FAQ: native <details>, so keyboard and screen-reader support come free.
 * The open/close animation is pure CSS where the browser supports it; other
 * browsers open instantly. No hooks: the parent passes the language.
 */
export function Faq({ lang }: { lang: Lang }) {
  return (
    <section id="faq" className={styles.faq} aria-labelledby="faq-title">
      <div className={`wrap ${styles.grid}`}>
        <div className={styles.head} data-reveal="">
          <p className="kicker">{t(lang, "faq.kicker")}</p>
          <h2 id="faq-title" className={styles.title}>
            {noOrphan(t(lang, "faq.title"))}
          </h2>
        </div>
        <div className={styles.list} data-reveal="">
          {FAQ_ITEMS.map((item) => (
            <details key={item.q} className={styles.item}>
              <summary className={styles.summary}>
                <span>{t(lang, item.q)}</span>
                <span className={styles.pm} aria-hidden />
              </summary>
              <div className={styles.answer}>
                <p>{t(lang, item.a)}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
