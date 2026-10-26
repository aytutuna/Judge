import type { CruxTrial, VerdictResult } from "@/lib/types";
import { t, type Key, type Lang } from "@/lib/i18n";
import { hyphenRuns, stripLeadingEmoji } from "@/lib/text";
import { confidenceLabel, leanTally, stampLabel, tugFinal, verdictLabel } from "@/lib/verdict-display";
import { MainSlot } from "./verdict/VerdictMain";
import { VoteDots, voteOf } from "./verdict/VoteDots";
import styles from "./verdict/verdict.module.css";

export { leanTally, tugFinal, verdictLabel };

/** The badge LABEL is one whole dictionary string per language ("Değer
 * tartışması"), never a translated stem + " dispute" suffix, which breaks in
 * an agglutinative language. */
const BADGE_KEY = {
  factual: "badge.factual",
  logical: "badge.logical",
  definitional: "badge.definitional",
  values: "badge.values",
  mixed: "badge.mixed",
} as const satisfies Record<VerdictResult["dispute_type"], Key>;

/** Normalize a conditional branch clause for display after the "If"/"Eğer"
 * prefix. BOTH markers are stripped in BOTH branches: share pages can pair
 * tr chrome with English content (and vice versa), and stripping only the
 * chrome-language marker would render a doubled marker — "Eğer If …" — or,
 * worse, tr-lowercase a surviving English "If" into the misspelling "ıf".
 * The tr path lowercases with toLocaleLowerCase("tr") — never
 * default-locale, which turns "İ" into "i̇" — and keeps the capital when the
 * clause starts with the party label "Taraf" or a restored real name
 * (`keep`). */
function conditionalClause(raw: string, lang: Lang, keep: readonly string[] = []): string {
  const s = raw.replace(/^(eğer|if)\s+/i, "");
  if (lang === "tr") {
    if (s.startsWith("Taraf") || keep.some((name) => name && s.startsWith(name))) return s;
    return s.charAt(0).toLocaleLowerCase("tr") + s.slice(1);
  }
  return /^(You|Your)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 16 16" className={styles.slotIcon} aria-hidden>
      <path
        d="M8 1.8 13 3.6v4c0 3-2.2 5.4-5 6.6-2.8-1.2-5-3.6-5-6.6v-4z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" className={styles.slotIcon} aria-hidden>
      <path
        d="M8 2 14.5 13.5h-13z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <path d="M8 6.5v3.2" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      <circle cx={8} cy={11.6} r={0.9} fill="currentColor" />
    </svg>
  );
}

/** Outcome of the adversarial cross-examination of a fact/logic winner
 * ruling. Survived is styled neutral, not green: green here means
 * user-checkable verified facts, and a green shield would read as an
 * endorsement badge — exactly the confidence-laundering this app forbids.
 * "Capped" (never "reduced") because the cap may equal the pre-trial number.
 * The dictionary's leading emoji is swapped for a drawn icon. */
function CruxTrialNote({ trial, lang }: { trial: CruxTrial; lang: Lang }) {
  if (trial.outcome === "survived") {
    return (
      <MainSlot>
        <p className={styles.slotText} style={{ color: "var(--ink-2)" }}>
          <ShieldIcon /> {stripLeadingEmoji(t(lang, "trial.survived"))}
        </p>
        {trial.attack.trim() ? (
          <details className={styles.details}>
            <summary>{t(lang, "trial.whatWasTested")}</summary>
            <p>
              {t(lang, "trial.attackPrefix")} {trial.attack}
            </p>
            {trial.reasoning ? (
              <p>
                {t(lang, "trial.refereePrefix")} {trial.reasoning}
              </p>
            ) : null}
          </details>
        ) : null}
      </MainSlot>
    );
  }
  const overturned = trial.outcome === "overturned";
  return (
    <MainSlot>
      <p
        className={overturned ? `${styles.slotText} ${styles.danger}` : styles.slotText}
        style={overturned ? undefined : { color: "var(--ink-2)" }}
      >
        <AlertIcon /> {stripLeadingEmoji(t(lang, overturned ? "trial.overturned" : "trial.uncertain"))}
      </p>
      <p className={styles.slotText} style={{ textAlign: "left" }}>
        {t(lang, "trial.attackPrefix")} {trial.attack}
      </p>
      {trial.reasoning ? (
        <p className={styles.slotText} style={{ textAlign: "left" }}>
          {t(lang, "trial.refereePrefix")} {trial.reasoning}
        </p>
      ) : null}
    </MainSlot>
  );
}

/**
 * The verdict itself, as the top of a VerdictCardShell body: the stamp
 * (decorative; the heading carries the ruling for screen readers), the
 * dispute kind, the headline as the card's heading, the votes and the
 * confidence (how many judges agreed), then the lean, trial, refusal and
 * demo notes and the split / conditional branches. The card's `animate` drives the entrance;
 * this markup is always the final state.
 */
export function VerdictReveal({
  result,
  nameA,
  nameB,
  aIsSelf,
  bIsSelf,
  lang,
  labelId,
  restoredNames = [],
}: {
  result: VerdictResult;
  nameA: string;
  nameB: string;
  aIsSelf: boolean;
  bIsSelf: boolean;
  lang: Lang;
  labelId?: string;
  /** Every real name restored into the text (other people included), so a
   * conditional opening with one keeps its capital. Never the narrator. */
  restoredNames?: readonly string[];
}) {
  const label = verdictLabel(result, nameA, nameB, aIsSelf, bIsSelf, lang);
  const confidence = confidenceLabel(lang, result);
  const lean = result.lean;
  const leanIsSelf = lean ? (lean.party === "a" ? aIsSelf : bIsSelf) : false;
  const leanName = lean ? (lean.party === "a" ? nameA : nameB) : "";
  // Real names that may open a conditional clause; never the "Sen"/"You" label.
  const keepCase = [aIsSelf ? "" : nameA, bIsSelf ? "" : nameB, ...restoredNames];

  return (
    <>
      <span className={styles.stamp} aria-hidden>
        <span className={styles.stampText}>{stampLabel(result, nameA, nameB, aIsSelf, bIsSelf, lang)}</span>
      </span>

      <div className={styles.lead}>
        <p className={styles.dispute}>{t(lang, BADGE_KEY[result.dispute_type])}</p>
        <h2 id={labelId} className={styles.ruling}>
          <span className="sr-only">{label}. </span>
          {hyphenRuns(result.headline).map((r, i) =>
            r.keep ? (
              <span key={i} className={styles.nobreak}>
                {r.text}
              </span>
            ) : (
              r.text
            ),
          )}
        </h2>
        {confidence ? (
          <div className={styles.meta}>
            <VoteDots votes={result.runs.map(voteOf)} />
            <span>{confidence}</span>
          </div>
        ) : null}
      </div>
      <hr className={styles.rule} />

      <div className={styles.notes}>
        {/* Forced ruling: the confidence above scores the MAIN verdict; the
            lean neither borrows it nor gets deflated by it. Lean and
            crux_trial never coexist (trials are winner-only, leans are
            non-winner-only). */}
        {lean ? (
          <MainSlot>
            <p className={styles.slotTitle}>
              <i
                aria-hidden
                className={styles.nameDot}
                style={{ background: lean.party === "a" ? "var(--terra)" : "var(--sage-strong)" }}
              />
              {leanIsSelf ? t(lang, "lean.titleSelf") : t(lang, "lean.title", { name: leanName })}
            </p>
            <p className={styles.slotText}>{lean.reason}</p>
            {result.runs.length >= 2 ? (
              <p className={styles.slotText}>
                {lean.unanimous
                  ? t(lang, "lean.unanimous")
                  : t(lang, "lean.majority", leanTally(lean, result.runs.length))}
              </p>
            ) : null}
          </MainSlot>
        ) : lean === null ? (
          <MainSlot>
            <p className={styles.slotText}>{t(lang, "lean.tie")}</p>
          </MainSlot>
        ) : null}

        {result.crux_trial ? <CruxTrialNote trial={result.crux_trial} lang={lang} /> : null}

        {result.model_refused ? (
          <MainSlot>
            <p className={styles.slotText}>{t(lang, "refusedNote")}</p>
          </MainSlot>
        ) : null}
        {result.demo ? (
          <MainSlot>
            <p className={styles.slotText}>{stripLeadingEmoji(t(lang, "demoNote"))}</p>
          </MainSlot>
        ) : null}
      </div>

      {result.verdict === "split" && result.split_points?.length ? (
        <div className={styles.branches}>
          {result.split_points.map((p, i) => {
            const isSelf = p.party === "a" ? aIsSelf : bIsSelf;
            const name = p.party === "a" ? nameA : nameB;
            return (
              <div
                key={i}
                className={`${styles.branch} ${p.party === "a" ? styles.branchA : styles.branchB}`}
              >
                <span className={styles.branchLead}>
                  {t(lang, isSelf ? "splitWinSelf" : "splitWin", { name })}
                </span>{" "}
                {p.point}
              </div>
            );
          })}
        </div>
      ) : null}

      {result.verdict === "conditional" && result.conditional?.length ? (
        <div className={styles.branches}>
          {result.conditional.map((c, i) => (
            <div key={i} className={`${styles.branch} ${styles.branchIf}`}>
              <span className={styles.branchLead}>
                {t(lang, "ifPrefix")} {conditionalClause(c.if_value, lang, keepCase)}
              </span>
              <span aria-hidden> → </span>
              {c.then}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
