import type { ReactNode } from "react";
import type { VerdictResult } from "@/lib/types";
import { t, type Lang } from "@/lib/i18n";
import { langDir } from "@/lib/langs";
import type { Party } from "@/lib/palette";
import { hyphenRuns } from "@/lib/text";
import { confidenceLabel, leanShare, tugFinal, verdictLabel } from "@/lib/verdict-display";
import { BalanceFallback } from "../scene/BalanceFallback";
import { VoteDots, voteOf } from "./VoteDots";
import { WhyBlock } from "./WhyBlock";
import styles from "./verdict.module.css";

/** Languages written without spaces between words: the "If" prefix runs
 * straight into the clause. */
const UNSPACED: readonly Lang[] = ["ja", "zh-Hans", "zh-Hant", "th"];

/** Normalize a conditional branch clause for display after the "If"/"Eğer"
 * prefix. BOTH markers are stripped in BOTH branches: share pages can pair
 * tr chrome with English content (and vice versa), and stripping only the
 * chrome-language marker would render a doubled marker — "Eğer If …" — or,
 * worse, tr-lowercase a surviving English "If" into the misspelling "ıf".
 * The tr path lowercases with toLocaleLowerCase("tr") — never
 * default-locale, which turns "İ" into "i̇" — and keeps the capital when the
 * clause starts with the party label "Taraf" or a restored real name
 * (`keep`). */
export function conditionalClause(raw: string, lang: Lang, keep: readonly string[] = []): string {
  let s = raw.replace(/^(eğer|if)\s+/i, "");
  if (lang !== "en" && lang !== "tr") {
    const own = t(lang, "ifPrefix").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const end = UNSPACED.includes(lang) ? "" : String.raw`(?![\p{L}\p{N}])`;
    s = s.replace(new RegExp(`^${own}${end}\\s*`, "iu"), "");
  }
  if (lang === "tr") {
    if (s.startsWith("Taraf") || keep.some((name) => name && s.startsWith(name))) return s;
    return s.charAt(0).toLocaleLowerCase("tr") + s.slice(1);
  }
  return /^(You|Your)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function Names({ nameA, nameB, lang }: { nameA: string; nameB: string; lang: Lang }) {
  return (
    <div className={styles.names}>
      <div className={styles.who}>
        <span className={styles.avatar} aria-hidden>
          A
        </span>
        <span className={`${styles.nameText} ${styles.nameA}`}>{nameA}</span>
      </div>
      <span className={styles.vs}>{t(lang, "card.vs")}</span>
      <div className={`${styles.who} ${styles.whoB}`}>
        <span className={`${styles.nameText} ${styles.nameB}`}>{nameB}</span>
        <span className={`${styles.avatar} ${styles.avatarB}`} aria-hidden>
          B
        </span>
      </div>
    </div>
  );
}

function LeanBar({ share, nameA, nameB, lang }: { share: number; nameA: string; nameB: string; lang: Lang }) {
  const label =
    share === 0.5
      ? t(lang, "card.leanNone")
      : t(lang, "card.leanTo", { name: share > 0.5 ? nameA : nameB });
  return (
    <div className={styles.lean} role="img" aria-label={label}>
      <div className={styles.leanFill} style={{ width: `${share * 100}%` }} />
    </div>
  );
}

/**
 * The paper verdict card, laid out like the apps': the settled balance, the
 * two names, the lean bar, the ruling line (label, one dot per judge,
 * confidence), the headline as the card's heading, why and the split /
 * conditional branches. Hook-free, so the share page can render it on the
 * server.
 *
 * - `top` renders after the scene, OUTSIDE the busy region: it holds the translation live
 *   region, and screen readers may hold back announcements from inside an
 *   aria-busy subtree.
 * - `busy`: aria-busy plus .55 opacity on the body (a translation is loading).
 * - `highlight`: the sage "fresh" ring, fading out over 2.6s.
 * - `animate`: the live entrance (the card rises). Pure CSS; reduced motion
 *   shows the final state.
 * - `you`: the viewer's party, drawn green.
 */
export function VerdictCard({
  result,
  nameA,
  nameB,
  aIsSelf,
  bIsSelf,
  lang,
  labelId,
  restoredNames = [],
  top,
  you = null,
  highlight = false,
  busy = false,
  animate = false,
  headingAs: Heading = "h2",
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
  top?: ReactNode;
  you?: Party | null;
  highlight?: boolean;
  busy?: boolean;
  animate?: boolean;
  headingAs?: "h2" | "h3";
}) {
  const label = verdictLabel(result, nameA, nameB, aIsSelf, bIsSelf, lang);
  const confidence = confidenceLabel(lang, result);
  const share = leanShare(result);
  const refused = Boolean(result.model_refused);
  const win = result.verdict === "side_a" ? "a" : result.verdict === "side_b" ? "b" : undefined;
  // Real names that may open a conditional clause; never the "Sen"/"You" label.
  const keepCase = [aIsSelf ? "" : nameA, bIsSelf ? "" : nameB, ...restoredNames];
  const cls = [styles.shell, animate && styles.animate, highlight && styles.fresh].filter(Boolean).join(" ");

  return (
    <article className={cls} aria-labelledby={labelId}>
      <div className={styles.scene}>
        <BalanceFallback tugA={refused ? 50 : tugFinal(result)} you={you} />
      </div>
      {top}
      <div className={busy ? `${styles.body} ${styles.busy}` : styles.body} aria-busy={busy}>
        <Names nameA={nameA} nameB={nameB} lang={lang} />
        {share !== null ? <LeanBar share={share} nameA={nameA} nameB={nameB} lang={lang} /> : null}

        <div className={styles.ruleLine}>
          <span className={styles.ruleLabel} data-win={win} aria-hidden>
            {label}
          </span>
          <span className={styles.ruleMeta}>
            <VoteDots votes={result.runs.map(voteOf)} />
            {confidence}
          </span>
        </div>

        <Heading id={labelId} className={styles.ruling}>
          {result.headline ? (
            <>
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
            </>
          ) : (
            label
          )}
        </Heading>

        {!refused && result.why ? <WhyBlock title={t(lang, "why")} text={result.why} /> : null}

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
                  {t(lang, "ifPrefix")}
                  {UNSPACED.includes(lang) ? "" : " "}
                  {conditionalClause(c.if_value, lang, keepCase)}
                </span>
                <span aria-hidden> {langDir(lang) === "rtl" ? "←" : "→"} </span>
                {c.then}
              </div>
            ))}
          </div>
        ) : null}

        {refused ? <p className={styles.refusal}>{t(lang, "refusedNote")}</p> : null}
      </div>
    </article>
  );
}
