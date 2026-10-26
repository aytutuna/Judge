"use client";

import { useId, useMemo } from "react";
import type { NameMapping, VerdictResult } from "@/lib/types";
import { t, type Key, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { consistentSelfMap, partyNames, personalizeResult, resolveParties, type SelfParty } from "@/lib/names";
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
import type { OwnerShare } from "./ShareDialog";
import { VerdictCardShell } from "./verdict/VerdictCardShell";
import { CardBrand, CardTopRow } from "./verdict/CardTopRow";
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

/** "Deniz's best point" when one side won, the plain title otherwise. */
function bestPointTitle(
  lang: Lang,
  result: VerdictResult,
  p: { nameA: string; nameB: string; aIsSelf: boolean; bIsSelf: boolean },
): string {
  if (result.verdict !== "side_a" && result.verdict !== "side_b") return stripLeadingEmoji(t(lang, "bestPointTitle"));
  const loserA = result.verdict === "side_b";
  if (loserA ? p.aIsSelf : p.bIsSelf) return t(lang, "bestPoint.self");
  return t(lang, "bestPoint.of", { name: loserA ? p.nameA : p.nameB });
}

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

/** Full verdict display: the card (stamp, headline, confidence and votes,
 * branches, crux, bedrock, best point, actions), then the argument map and
 * facts below it.
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
 * With a `nameMap` (the writer's own view) the real names go back into the
 * verdict text as well as the labels. Share pages pass the writer's chosen
 * display names as the map with `publicNames`: nobody is "You" there and a
 * display name such as "Ben" stays a name. Display-only: the share title and
 * anything that leaves the page use the anonymized text. `owner` (the
 * writer's views) adds the names dialog to the share buttons.
 * `selfParty` says whose narrator the map describes: "B" on the respondent's
 * own view of a two-sided case. `viewerIsSelfParty` (case pages only, where
 * the server says which party is looking) labels that party "Party A (you)"
 * when this browser has no names for it. The viewer is named one way per
 * verdict (consistentSelfMap): when any of their labels cannot be turned
 * into "you" grammatically, every mention keeps the label and the header
 * says "Party A (you)" (or "Ayşe (you)" when the writer saved `selfDisplayName`
 * for themselves, so their view reads like the share page with the name in
 * the text). `focusAppeal` moves keyboard focus to the appeal
 * outcome banner (an appeal just finished and its form is gone). Two-sided results (agreed and disputed
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
  focusAppeal = false,
  publicNames = false,
  selfDisplayName = null,
  owner,
}: {
  result: VerdictResult;
  nameMap?: NameMapping[];
  shareId?: string;
  lang?: Lang;
  onJudgeAnother?: () => void;
  fresh?: boolean;
  selfParty?: SelfParty;
  viewerIsSelfParty?: boolean;
  focusAppeal?: boolean;
  publicNames?: boolean;
  /** The display name the viewer chose for their own party (shown on the share page). */
  selfDisplayName?: string | null;
  owner?: OwnerShare;
}) {
  const storeLang = useLang();
  const opts = useMemo(() => ({ noSelf: publicNames }), [publicNames]);
  const lang = langProp ?? storeLang;
  // Narrator detection follows the language the argument was judged in;
  // only the labels follow the display language.
  const selfLang = verdictLang(original);
  const view = useVerdictTranslation(shareId, original, lang);
  const shown = useMemo(() => {
    const s = consistentSelfMap(view.result, nameMap, selfLang, selfParty, opts);
    // "You" can't be restored everywhere: use the viewer's own display name
    // (a plain name, restored like any other) instead of the bare label.
    if (!s.selfDropped || !selfDisplayName) return { ...s, selfName: null };
    const selfEntry = { original: selfDisplayName, replacement: `Party ${selfParty}` };
    return { nameMap: [...(s.nameMap ?? []), selfEntry], selfDropped: true, selfName: selfDisplayName };
  }, [view.result, nameMap, selfLang, selfParty, opts, selfDisplayName]);
  const named = partyNames(shown.nameMap, lang, selfLang, selfParty, viewerIsSelfParty || shown.selfDropped, opts);
  const selfLabel = shown.selfName ? t(lang, "party.youLabel", { label: shown.selfName }) : null;
  const nameA = selfLabel && selfParty === "A" ? selfLabel : named.nameA;
  const nameB = selfLabel && selfParty === "B" ? selfLabel : named.nameB;
  const aIsSelf = named.aIsSelf || Boolean(selfLabel && selfParty === "A");
  const bIsSelf = named.bIsSelf || Boolean(selfLabel && selfParty === "B");
  const result = useMemo(
    () => personalizeResult(view.result, shown.nameMap, selfLang, selfParty, opts),
    [view.result, shown.nameMap, selfLang, selfParty, opts],
  );
  const restoredNames = useMemo(
    () =>
      [...resolveParties(shown.nameMap, selfLang, selfParty, opts).values()].filter((p) => !p.self).map((p) => p.name),
    [shown.nameMap, selfLang, selfParty, opts],
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
          lang={lang}
          byName={result.appeal.by === "a" ? nameA : nameB}
          bySelf={result.appeal.by === "a" ? aIsSelf : bIsSelf}
          focus={focusAppeal}
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
            votes={[]}
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
          <section className={styles.section}>
            <h3 className={styles.sectionLabel}>{stripLeadingEmoji(t(lang, "cruxShort"))}</h3>
            <p className={styles.sectionText}>{result.crux}</p>
          </section>
        ) : null}

        {!refused && (result.argument_map.bedrock_a || result.argument_map.bedrock_b) ? (
          <section className={styles.section}>
            <h3 className={styles.sectionLabel}>{stripLeadingEmoji(t(lang, "bedrock"))}</h3>
            <div className={styles.tiles}>
              <div className={styles.tile}>
                <span className={styles.tileName} data-party="a">
                  {nameA}
                </span>
                <p>{result.argument_map.bedrock_a}</p>
              </div>
              <div className={styles.tile}>
                <span className={styles.tileName} data-party="b">
                  {nameB}
                </span>
                <p>{result.argument_map.bedrock_b}</p>
              </div>
            </div>
          </section>
        ) : null}

        {!refused && result.losing_side_best_point ? (
          <section className={styles.section}>
            <h3 className={styles.sectionLabel}>{bestPointTitle(lang, result, parties)}</h3>
            <p className={styles.sectionText}>{result.losing_side_best_point}</p>
          </section>
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
            shareId ? <ShareButtons shareId={shareId} title={view.result.headline} lang={lang} owner={owner} /> : null
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
          {result.fact_check ? <FactCheckList factCheck={result.fact_check} lang={lang} disputeType={result.dispute_type} /> : null}
          <FactChips facts={result.facts_relied_on} lang={lang} />
        </div>
      ) : null}
    </div>
  );
}
