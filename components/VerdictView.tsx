"use client";

import { useId } from "react";
import type { NameMapping, VerdictResult } from "@/lib/types";
import { t, type Key, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { partyNames } from "@/lib/names";
import { verdictLang } from "@/lib/content-lang";
import { stripLeadingEmoji } from "@/lib/text";
import { panelSummary } from "@/lib/verdict-display";
import { useVerdictTranslation, type TranslationView } from "@/lib/use-translation";
import { VerdictReveal } from "./VerdictReveal";
import { ArgumentMap } from "./ArgumentMap";
import { FactChips } from "./FactChips";
import { FactCheckList } from "./FactCheckList";
import { PremiumBadge } from "./PremiumBadge";
import { ShareButtons } from "./ShareButtons";
import { VerdictCardShell } from "./verdict/VerdictCardShell";
import { CardBrand, CardTopRow } from "./verdict/CardTopRow";
import { voteOf } from "./verdict/VoteDots";
import { CruxBlock } from "./verdict/CruxBlock";
import { BestPointBlock } from "./verdict/BestPointBlock";
import { CardActions } from "./verdict/CardActions";
import styles from "./verdict/verdict.module.css";

/** Non-side votes rendered whole from the dictionary — never
 * `r.replace("_", " ")`, which would splice raw English enum words into a
 * Turkish sentence. */
const VOTE_KEY = {
  split: "vote.split",
  conditional: "vote.conditional",
  dissolved: "vote.dissolved",
} as const satisfies Record<string, Key>;

/** Small status pill above a verdict whose text is (being) translated.
 * Polite live region, so a screen reader hears "Translating…" and then the
 * outcome without losing its place. */
function TranslationNote({ view, lang }: { view: TranslationView; lang: Lang }) {
  const text =
    view.status === "loading"
      ? t(lang, "translate.loading")
      : view.status === "translated"
        ? t(lang, view.source === "tr" ? "translate.from.tr" : "translate.from.en")
        : view.status === "error"
          ? t(lang, "translate.failed")
          : "";
  return (
    // Always mounted (a live region must exist before its text changes);
    // sr-only while empty, so it takes no room in the layout.
    <p className={text ? styles.note : "sr-only"} aria-live="polite">
      {view.status === "loading" ? <span className={styles.spinner} aria-hidden /> : null}
      {text}
    </p>
  );
}

/** Full verdict display: the card (tug bar, ruling, branches, crux, best
 * point, votes, actions), then the argument map and facts below it.
 * `lang` prop: the share page passes its own selected language (the store is
 * the viewer's own preference and never applies there); the main page passes
 * nothing and the store wins. With a `shareId`, the verdict TEXT follows
 * `lang` too: a verdict written in the other language is fetched translated
 * and swapped in, with the original kept for switching back.
 * `onJudgeAnother` adds a "Settle another one" action; `fresh` rings the card
 * in sage for a moment when it has just replaced the form.
 * Premium results (`tier: "premium"`) add a badge in the top row, a panel
 * line in the footnote and the web fact-check below the card; free results
 * render exactly as before. */
export function VerdictView({
  result: original,
  nameMap,
  shareId,
  lang: langProp,
  onJudgeAnother,
  fresh = false,
}: {
  result: VerdictResult;
  nameMap?: NameMapping[];
  shareId?: string;
  lang?: Lang;
  onJudgeAnother?: () => void;
  fresh?: boolean;
}) {
  const storeLang = useLang();
  const lang = langProp ?? storeLang;
  // Narrator detection follows the language the argument was judged in;
  // only the labels follow the display language.
  const { nameA, nameB, aIsSelf, bIsSelf } = partyNames(nameMap, lang, verdictLang(original));
  const view = useVerdictTranslation(shareId, original, lang);
  const result = view.result;
  const loading = view.status === "loading";
  const labelId = useId();
  const refused = Boolean(result.model_refused);
  const premium = result.tier === "premium";
  const pill = (
    <>
      {shareId ? <TranslationNote view={view} lang={lang} /> : null}
      {view.status === "original" ? <CardBrand /> : null}
    </>
  );

  return (
    <div className="flex flex-col gap-7 min-w-0">
      <VerdictCardShell
        labelledBy={labelId}
        busy={loading}
        highlight={fresh}
        animate
        top={
          <CardTopRow
            pill={
              premium ? (
                <span className={styles.pillGroup}>
                  {pill}
                  <PremiumBadge lang={lang} />
                </span>
              ) : (
                pill
              )
            }
            votes={result.runs.map(voteOf)}
          />
        }
      >
        <VerdictReveal
          result={result}
          nameA={nameA}
          nameB={nameB}
          aIsSelf={aIsSelf}
          bIsSelf={bIsSelf}
          lang={lang}
          labelId={labelId}
        />

        {!refused ? (
          <CruxBlock title={stripLeadingEmoji(t(lang, "cruxShort"))} text={result.crux} />
        ) : null}

        {!refused && result.losing_side_best_point ? (
          <BestPointBlock
            title={stripLeadingEmoji(t(lang, "bestPointTitle"))}
            text={result.losing_side_best_point}
          />
        ) : null}

        {/* The votes in words (the dots in the top row are decorative), plus
            the escalation note when extra judges were called in. */}
        {result.runs.length > 0 ? (
          <p className={styles.footnote}>
            {result.escalated ? (
              <>
                {t(lang, "escalated")}
                <br />
              </>
            ) : null}
            {t(lang, result.runs.length === 1 ? "judgesVoted.one" : "judgesVoted.other", {
              n: result.runs.length,
            })}{" "}
            {result.runs
              .map((r) =>
                r === "side_a" ? nameA : r === "side_b" ? nameB : t(lang, VOTE_KEY[r]),
              )
              .join(" · ")}
            {premium ? (
              <>
                <br />
                {t(lang, "panel.premium")}
                {result.panel?.models.length ? ` ${panelSummary(result.panel.models, lang)}` : null}
              </>
            ) : null}
          </p>
        ) : null}

        <CardActions
          share={
            shareId ? <ShareButtons shareId={shareId} title={result.headline} lang={lang} /> : null
          }
          again={
            onJudgeAnother ? { label: t(lang, "judgeAnother"), onClick: onJudgeAnother } : undefined
          }
        />
      </VerdictCardShell>

      {!refused ? (
        <div
          className={[styles.below, styles.animateBelow, loading && styles.busy]
            .filter(Boolean)
            .join(" ")}
          aria-busy={loading}
        >
          <ArgumentMap
            map={result.argument_map}
            crux={result.crux}
            nameA={nameA}
            nameB={nameB}
            lang={lang}
            showCrux={false}
          />
          {result.fact_check ? <FactCheckList factCheck={result.fact_check} lang={lang} /> : null}
          <FactChips facts={result.facts_relied_on} lang={lang} />
        </div>
      ) : null}
    </div>
  );
}
