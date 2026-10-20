import { t, type Lang } from "@/lib/i18n";
import type { DisputedFact, VerdictResult } from "@/lib/types";
import styles from "./case.module.css";

/** Display caps (the server normalizes the same; a second guard for stored
 * or hand-made rows). */
const MAX_AGREED = 5;
const MAX_DISPUTED = 4;
const MAX_WOULD_CHANGE = 3;

export type PartyLabels = { nameA: string; nameB: string; aIsSelf: boolean; bIsSelf: boolean };

/** Whether a result carries anything for the two-sided blocks. */
export function hasTwoSidedBlocks(r: VerdictResult): boolean {
  return Boolean(r.agreed_facts?.length || r.disputed_facts?.length || r.would_change?.length);
}

function findingText(lang: Lang, d: DisputedFact, p: PartyLabels): string {
  if (d.finding === "unsettled") return t(lang, "twoSided.finding.unsettled");
  const self = d.finding === "a" ? p.aIsSelf : p.bIsSelf;
  if (self) return t(lang, "twoSided.finding.self");
  return t(lang, d.finding === "a" ? "twoSided.finding.a" : "twoSided.finding.b", {
    name: d.finding === "a" ? p.nameA : p.nameB,
  });
}

function DecisiveGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden>
      <path d="M6.6 1 2.5 7h3L5 11l4.5-6.2h-3z" fill="currentColor" />
    </svg>
  );
}

/** "What would change this verdict": short, inside the card. */
export function WouldChangeBlock({ items, lang }: { items: readonly string[]; lang: Lang }) {
  const list = items.filter((s) => s.trim()).slice(0, MAX_WOULD_CHANGE);
  if (list.length === 0) return null;
  return (
    <section className={styles.wouldChange} aria-label={t(lang, "twoSided.wouldChange")}>
      <h3 className={`${styles.tsTitle} ${styles.tsTitleGap}`}>{t(lang, "twoSided.wouldChange")}</h3>
      <ul>
        {list.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </section>
  );
}

/** Agreed and disputed facts of a two-sided verdict, below the card. Each
 * finding chip says its side in words, never by colour alone; the decisive
 * dispute also gets a dashed frame and its own label. */
export function TwoSidedFacts({
  result,
  lang,
  parties,
}: {
  result: VerdictResult;
  lang: Lang;
  parties: PartyLabels;
}) {
  const agreed = (result.agreed_facts ?? []).filter((s) => s.trim()).slice(0, MAX_AGREED);
  const disputed = (result.disputed_facts ?? []).slice(0, MAX_DISPUTED);
  // At most one decisive marker, as the server promises.
  const decisiveAt = disputed.findIndex((d) => d.decisive);
  if (agreed.length === 0 && disputed.length === 0) return null;
  return (
    <div className={styles.ts}>
      {agreed.length > 0 ? (
        <section className={styles.ts} aria-labelledby="ts-agreed">
          <h3 id="ts-agreed" className={styles.tsTitle}>
            {t(lang, "twoSided.agreed")}
          </h3>
          <ul className={styles.agreed}>
            {agreed.map((fact, i) => (
              <li key={i}>
                <span className={styles.both} aria-hidden>
                  <i />
                  <i />
                </span>
                <span>{fact}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {disputed.length > 0 ? (
        <section className={styles.ts} aria-labelledby="ts-disputed">
          <h3 id="ts-disputed" className={styles.tsTitle}>
            {t(lang, "twoSided.disputed")}
          </h3>
          <ul className={styles.disputes}>
            {disputed.map((d, i) => (
              <li key={i} className={styles.dispute} data-decisive={i === decisiveAt ? "" : undefined}>
                <div className={styles.disputeTop}>
                  {i === decisiveAt ? (
                    <span className={styles.decisive}>
                      <DecisiveGlyph />
                      {t(lang, "twoSided.decisive")}
                    </span>
                  ) : null}
                  <span className={styles.finding} data-finding={d.finding}>
                    {findingText(lang, d, parties)}
                  </span>
                </div>
                <p className={styles.disputeFact}>{d.fact}</p>
                <dl className={styles.claims}>
                  <div className={`${styles.claimRow} ${styles.claimA}`}>
                    <dt>{parties.nameA}</dt>
                    <dd>{d.party_a}</dd>
                  </div>
                  <div className={`${styles.claimRow} ${styles.claimB}`}>
                    <dt>{parties.nameB}</dt>
                    <dd>{d.party_b}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** The evidence footnote line: per party on two-sided verdicts, a plain
 * count otherwise. Null when no image was read. */
export function evidenceNote(result: VerdictResult, lang: Lang): string | null {
  const used = result.evidence_used;
  if (!used || used.a + used.b === 0) return null;
  return result.two_sided
    ? t(lang, "evidence.used", { a: used.a, b: used.b })
    : t(lang, "evidence.usedOne", { n: used.a + used.b });
}
