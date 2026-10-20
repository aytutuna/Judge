"use client";

import { useId, useMemo } from "react";
import type { NameMapping, VerdictResult } from "@/lib/types";
import { t, type Key, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { partyNames, personalizeResult, resolveParties, type SelfParty } from "@/lib/names";
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
import { AppealOutcomeBanner } from "./case/AppealOutcome";
import { TwoSidedFacts, WouldChangeBlock, evidenceNote } from "./case/TwoSidedBlocks";
import caseStyles from "./case/case.module.css";
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
 * render exactly as before.
 * With a `nameMap` (the author's own view, right after judging) the real
 * names go back into the verdict text as well as the labels; share pages
 * pass none and stay anonymized. Display-only: the share title and anything
 * that leaves the page use the anonymized text.
 * `selfParty` says whose narrator the map describes: "B" on the respondent's
 * own view of a two-sided case. `viewerIsSelfParty` (case pages only, where
 * the server says which party is looking) labels that party "Party A (you)"
 * when this browser has no names for it. Two-sided results (agreed and disputed
 * facts, what would change the verdict), an evidence count and an appeal
 * outcome render only when the result carries them. */
export function VerdictView({
  result: original,
  nameMap,
  shareId,
  lang: langProp,
  onJudgeAnother,
  fresh = false,
  selfParty = "A",
  viewerIsSelfParty = false,
}: {
  result: VerdictResult;
  nameMap?: NameMapping[];
  shareId?: string;
  lang?: Lang;
  onJudgeAnother?: () => void;
  fresh?: boolean;
  selfParty?: SelfParty;
  viewerIsSelfParty?: boolean;
}) {
  const storeLang = useLang();
  const lang = langProp ?? storeLang;
  // Narrator detection follows the language the argument was judged in;
  // only the labels follow the display language.
  const selfLang = verdictLang(original);
  const { nameA, nameB, aIsSelf, bIsSelf } = partyNames(nameMap, lang, selfLang, selfParty, viewerIsSelfParty);
  const view = useVerdictTranslation(shareId, original, lang);
  const result = useMemo(
    () => personalizeResult(view.result, nameMap, selfLang, selfParty),
    [view.result, nameMap, selfLang, selfParty],
  );
  const restoredNames = useMemo(
    () => [...resolveParties(nameMap, selfLang, selfParty).values()].filter((p) => !p.self).map((p) => p.name),
    [nameMap, selfLang, selfParty],
  );
  const loading = view.status === "loading";
  const labelId = useId();
  const refused = Boolean(result.model_refused);
  const premium = result.tier === "premium";
  const twoSided = result.two_sided === true;
  const evidenceLine = evidenceNote(result, lang);
  const parties = { nameA, nameB, aIsSelf, bIsSelf };
  const pill = (
    <>
      {shareId ? <TranslationNote view={view} lang={lang} /> : null}
      {view.status === "original" ? <CardBrand /> : null}
    </>
  );

  return (
    <div className="flex flex-col gap-7 min-w-0">
      {result.appeal ? (
        <AppealOutcomeBanner
          appeal={result.appeal}
          confidence={result.confidence}
          lang={lang}
          byName={result.appeal.by === "a" ? nameA : nameB}
          bySelf={result.appeal.by === "a" ? aIsSelf : bIsSelf}
        />
      ) : null}
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
                  {twoSided ? <span className={caseStyles.tsBadge}>{t(lang, "twoSided.badge")}</span> : null}
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
          restoredNames={restoredNames}
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

        {!refused && result.would_change?.length ? (
          <WouldChangeBlock items={result.would_change} lang={lang} />
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
            {evidenceLine ? (
              <>
                <br />
                {evidenceLine}
              </>
            ) : null}
          </p>
        ) : null}

        <CardActions
          share={
            shareId ? <ShareButtons shareId={shareId} title={view.result.headline} lang={lang} /> : null
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
          {twoSided ? <TwoSidedFacts result={result} lang={lang} parties={parties} /> : null}
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
