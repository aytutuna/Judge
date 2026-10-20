import { t, type Key, type Lang } from "@/lib/i18n";
import type { AppealInfo, AppealOutcome } from "@/lib/types";
import styles from "./case.module.css";

const OUTCOME_KEY = {
  upheld: "appeal.outcome.upheld",
  overturned: "appeal.outcome.overturned",
  changed: "appeal.outcome.changed",
} as const satisfies Record<AppealOutcome, Key>;

const GENERIC_KEY = {
  upheld: "appeal.generic.upheld",
  overturned: "appeal.generic.overturned",
  changed: "appeal.generic.changed",
} as const satisfies Record<AppealOutcome, Key>;

export function outcomeLabel(lang: Lang, outcome: AppealOutcome): string {
  return t(lang, OUTCOME_KEY[outcome]);
}

function OutcomeGlyph({ outcome }: { outcome: AppealOutcome }) {
  const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 12 12" aria-hidden>
      {outcome === "upheld" ? <path d="M2.5 4.6h7M2.5 7.4h7" {...line} /> : null}
      {outcome === "overturned" ? <path d="M2.5 4.5h6.5l-2-2M9.5 7.5H3l2 2" {...line} /> : null}
      {outcome === "changed" ? <path d="M2.5 6h7M6.5 3l3 3-3 3" {...line} /> : null}
    </svg>
  );
}

/**
 * Banner on a verdict produced by an appeal: the outcome label, which names
 * what happened to the verdict (stands / flipped / changed) so it never
 * reads as the appeal's own success, who added context, the confidence
 * change on the 1-5 scale and the one-sentence summary (or a generic line
 * when the summary is empty). The "stands" chip is neutral: a green tick
 * would read as "you won".
 * `byName` is the display name of the appealing party; `bySelf` switches to
 * the second-person line on that party's own view.
 */
export function AppealOutcomeBanner({
  appeal,
  confidence,
  lang,
  byName,
  bySelf,
}: {
  appeal: AppealInfo;
  confidence: number;
  lang: Lang;
  byName: string;
  bySelf: boolean;
}) {
  const from = appeal.previous_confidence;
  const to = confidence;
  return (
    <section className={styles.outcome} aria-label={outcomeLabel(lang, appeal.outcome)}>
      <div className={styles.outcomeTop}>
        <span className={styles.outcomeChip} data-outcome={appeal.outcome}>
          <OutcomeGlyph outcome={appeal.outcome} />
          {outcomeLabel(lang, appeal.outcome)}
        </span>
        <span className={styles.outcomeBy}>
          {bySelf ? t(lang, "appeal.bySelf") : t(lang, "appeal.by", { name: byName })}
        </span>
        <span className={styles.outcomeConf}>
          {from === to ? (
            t(lang, "appeal.confidenceSame", { n: to })
          ) : (
            <>
              {t(lang, "appeal.confidence", { from })} <span aria-hidden>→</span>
              <span className="sr-only">{t(lang, "appeal.confidenceTo")}</span> {to}/5
            </>
          )}
        </span>
      </div>
      <p className={styles.outcomeText}>{appeal.summary.trim() || t(lang, GENERIC_KEY[appeal.outcome])}</p>
    </section>
  );
}
