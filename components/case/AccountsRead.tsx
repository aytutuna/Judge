import type { CaseAppealView, CaseEvidenceView, CaseSideView, PartyLetter } from "@/lib/case-types";
import { t, type Lang } from "@/lib/i18n";
import styles from "./case.module.css";

function Evidence({ items, lang }: { items: readonly CaseEvidenceView[]; lang: Lang }) {
  return (
    <>
      {items.map((ev, i) => (
        <details key={ev.id} className={styles.transcript}>
          <summary>{t(lang, "case.evidenceItem", { n: i + 1 })}</summary>
          <pre>{ev.transcript}</pre>
        </details>
      ))}
    </>
  );
}

/**
 * The accounts exactly as the judges read them: anonymized text plus the
 * anonymized transcripts of any images. Before a verdict the server only
 * sends the viewer's own side; after a two-sided verdict it sends both, and
 * any context added by appeal. Names are deliberately not restored here:
 * this is the record as judged. The viewer's own account and context say
 * "yours" next to their label, so the labels in the text can be placed.
 */
export function AccountsRead({
  lang,
  title,
  sides,
  appeals = [],
  yourParty,
}: {
  lang: Lang;
  title: string;
  sides: readonly CaseSideView[];
  appeals?: readonly CaseAppealView[];
  /** The viewer's party (from the case view). */
  yourParty?: PartyLetter;
}) {
  const label = (p: PartyLetter) => t(lang, p === "a" ? "party.a" : "party.b");
  if (sides.length === 0) return null;
  const ordered = [...sides].sort((x, y) => x.party.localeCompare(y.party));
  const added = appeals.filter((a) => a.status !== "failed" && a.text.trim());
  return (
    <section className={styles.stack} aria-labelledby="accounts-title">
      <h2 id="accounts-title" className={styles.h2}>
        {title}
      </h2>
      <div className={`${styles.accounts} ${ordered.length > 1 ? styles.accountsTwo : ""}`}>
        {ordered.map((side) => (
          <article
            key={side.party}
            className={`${styles.account} ${side.party === "a" ? styles.accountA : styles.accountB}`}
          >
            <h3 className={styles.accountHead}>
              {side.party === yourParty
                ? t(lang, "case.accountYou", { label: label(side.party) })
                : t(lang, side.party === "a" ? "case.accountA" : "case.accountB")}
            </h3>
            <p className={styles.accountText}>{side.text}</p>
            <Evidence items={side.evidence} lang={lang} />
          </article>
        ))}
      </div>
      {added.map((a) => (
        <article key={a.id} className={`${styles.account} ${a.party === "a" ? styles.accountA : styles.accountB}`}>
          <h3 className={styles.accountHead}>
            {a.party === yourParty
              ? t(lang, "case.contextYou", { label: label(a.party) })
              : t(lang, a.party === "a" ? "case.contextA" : "case.contextB")}
          </h3>
          <p className={styles.accountText}>{a.text}</p>
          <Evidence items={a.evidence} lang={lang} />
        </article>
      ))}
    </section>
  );
}
