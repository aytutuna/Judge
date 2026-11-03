"use client";

import { useEffect, useId, useMemo } from "react";
import { track } from "@/lib/analytics/client";
import type { NameMapping, VerdictResult } from "@/lib/types";
import { languageName, t, type Lang } from "@/lib/i18n";
import { langDir } from "@/lib/langs";
import { useLang } from "@/lib/lang";
import { consistentSelfMap, partyNames, personalizeResult, resolveParties, type SelfParty } from "@/lib/names";
import { verdictLang } from "@/lib/content-lang";
import { useVerdictTranslation, type TranslationView } from "@/lib/use-translation";
import { ShareButtons } from "./ShareButtons";
import type { OwnerShare } from "./ShareDialog";
import { VerdictCard } from "./verdict/VerdictCard";
import { VerdictDetails } from "./verdict/VerdictDetails";
import { AppealOutcomeBanner } from "./case/AppealOutcome";
import styles from "./verdict/verdict.module.css";

/** Verdicts already counted as viewed, so a remount does not count again. */
const viewed = new Set<string>();

/** "Translated from Turkish". A source with no sentence of its own reads
 * "German → English", which needs no grammar in any language. */
function translatedFrom(lang: Lang, source: Lang): string {
  if (source === "en" || source === "tr") return t(lang, source === "tr" ? "translate.from.tr" : "translate.from.en");
  return `${languageName(lang, source)} ${langDir(lang) === "rtl" ? "←" : "→"} ${languageName(lang, lang)}`;
}

/** Small status pill above a verdict whose text is (being) translated.
 * Polite live region, so a screen reader hears "Translating…" and then the
 * outcome without losing its place. */
function TranslationNote({ view, lang }: { view: TranslationView; lang: Lang }) {
  const text =
    view.status === "loading"
      ? t(lang, "translate.loading")
      : view.status === "translated"
        ? translatedFrom(lang, view.source)
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

/** Full verdict display: the card (balance, names, lean bar, ruling line,
 * headline, why, branches), the detail rows with their panel (crux, sides,
 * best point, facts) and the share / appeal actions.
 * `lang` prop: the share page passes its own selected language (the store is
 * the viewer's own preference and never applies there); the main page passes
 * nothing and the store wins. With a `shareId`, the verdict TEXT follows
 * `lang` too: a verdict written in the other language is fetched translated
 * and swapped in, with the original kept for switching back.
 * `onAddContext` puts "Add context & appeal" beside Share (the writer's
 * verdict); `fresh` rings the card in sage for a moment when it has just
 * replaced the form.
 * `verdictId` is the shown result's own id when the page is another
 * verdict's (a round of added context shown on its first verdict's page):
 * translation follows it, sharing stays on `shareId`.
 * Premium results (`tier: "premium"`) add a panel line in the footnote and
 * the web fact-check to the details; old free results render as before.
 * With a `nameMap` (the writer's own view) the real names go back into the
 * verdict text as well as the labels. Share pages pass the writer's chosen
 * display names as the map with `publicNames`: nobody is "You" there and a
 * display name such as "Ben" stays a name. Display-only: the share title and
 * anything that leaves the page use the anonymized text. `owner` (the
 * writer's views) adds the names dialog to the share buttons.
 * `selfParty` says whose narrator the map describes: "B" on the respondent's
 * own view of a two-sided case. It is also the side drawn in green, the
 * other one in red. `viewerIsSelfParty` (case pages only, where
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
  onAddContext,
  verdictId,
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
  onAddContext?: () => void;
  verdictId?: string;
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
  useEffect(() => {
    if (!shareId || viewed.has(shareId)) return;
    viewed.add(shareId);
    track("verdict_viewed");
  }, [shareId]);
  // Narrator detection follows the language the argument was judged in;
  // only the labels follow the display language.
  const selfLang = verdictLang(original);
  const view = useVerdictTranslation(verdictId ?? shareId, original, lang);
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
  const parties = { nameA, nameB, aIsSelf, bIsSelf };

  return (
    <div className="flex flex-col gap-3 min-w-0" data-you={selfParty === "B" ? "b" : "a"}>
      {result.appeal ? (
        <div className="pb-2">
          <AppealOutcomeBanner
            appeal={result.appeal}
            lang={lang}
            byName={result.appeal.by === "a" ? nameA : nameB}
            bySelf={result.appeal.by === "a" ? aIsSelf : bIsSelf}
            focus={focusAppeal}
          />
        </div>
      ) : null}
      <VerdictCard
        result={result}
        nameA={nameA}
        nameB={nameB}
        aIsSelf={aIsSelf}
        bIsSelf={bIsSelf}
        lang={lang}
        labelId={labelId}
        restoredNames={restoredNames}
        top={shareId ? <TranslationNote view={view} lang={lang} /> : null}
        you={selfParty === "B" ? "b" : "a"}
        busy={loading}
        highlight={fresh}
        animate
      />
      <VerdictDetails result={result} parties={parties} lang={lang} loading={loading} />
      {shareId ? (
        <ShareButtons
          shareId={shareId}
          title={view.result.headline}
          lang={lang}
          owner={owner}
          onAddContext={onAddContext}
        />
      ) : null}
    </div>
  );
}
