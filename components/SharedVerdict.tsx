"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { verdictLang } from "@/lib/content-lang";
import { t, type Lang } from "@/lib/i18n";
import { useLocaleLang } from "@/lib/lang";
import type { DisplayState } from "@/lib/originals-types";
import { useOwnerToken } from "@/lib/owner-store";
import type { NameMapping, VerdictResult } from "@/lib/types";
import { useViewer } from "@/lib/use-viewer";
import { LangToggle } from "./LangToggle";
import { OwnerPanel, useMine } from "./OwnerTools";
import { RemovedVerdict } from "./RemovedVerdict";
import { buildOwnerShare } from "./ShareDialog";
import { NextSteps } from "./thread/Composer";
import { Thread } from "./thread/Thread";
import { useVerdictAppeal, withRoundNames, type ShownVerdict } from "./VerdictAppeal";
import { VerdictView } from "./VerdictView";
import { VerdictHistory } from "./case/VerdictHistory";
import styles from "./verdict/verdict.module.css";

/** Share-page verdict whose language the viewer picks. Starts in the page's
 * Accept-Language; the choice stays on this page (it never writes the home
 * page's stored preference) and VerdictView brings the verdict text along.
 * Everyone gets the public view (display names, or labels when names are
 * off). The verdict's writer (owner token in this browser, or the signed-in
 * owner) is switched to their own view after hydration: real names from
 * their stored map, what they wrote, the names editor and removal.
 * It renders the page's h1 kicker (in the page language, `initialLang`):
 * "Someone shared this ruling" for everyone, "Your verdict" once the writer
 * is recognized. `balance` sits between the kicker and the card, `cta`
 * under it. The writer gets their verdict as a thread instead: what they
 * wrote, the verdict, their tools, and "New argument". After a removal,
 * only the removed card is left, its heading focused.
 * `rounds`: the verdicts the writer's added context produced, oldest first.
 * The last one is the current ruling, so the page shows it (with how it
 * compares to the one before) under this verdict's link; the writer also
 * gets the earlier ones and "Add context" as the card's action. */
export function SharedVerdict({
  id,
  result,
  createdAt,
  rounds = [],
  initialLang,
  publicNames = null,
  kickerClassName,
  cardClassName,
  balance = null,
  cta = null,
}: {
  id: string;
  result: VerdictResult;
  createdAt: string;
  rounds?: ShownVerdict[];
  initialLang: Lang;
  /** Display name -> label, from the server; null shows the labels. */
  publicNames?: NameMapping[] | null;
  kickerClassName?: string;
  cardClassName?: string;
  balance?: ReactNode;
  cta?: ReactNode;
}) {
  const [picked, setPicked] = useState<Lang>(initialLang);
  const lang = useLocaleLang(picked);
  const token = useOwnerToken(id);
  const viewer = useViewer();
  const signedIn = viewer.status === "ready" || viewer.status === "error" ? Boolean(viewer.me?.user) : null;
  const mine = useMine(id, token, token ? true : signedIn);
  const [display, setDisplay] = useState<DisplayState | null>(null);
  const [removed, setRemoved] = useState(false);
  const removedHeadingId = useId();
  const label = t(lang, "translate.toggle");
  const ownView = mine && !mine.removed && mine.result ? mine : null;
  const appeal = useVerdictAppeal({
    id,
    lang,
    token: token ?? null,
    enabled: Boolean(ownView && !ownView.case),
    initial: [{ id, result, createdAt }, ...rounds],
    evidence: viewer.config?.features?.evidence === true,
  });
  const current = appeal.verdicts.at(-1) ?? { id, result, createdAt };
  const roundId = current.id === id ? undefined : current.id;

  // The confirm dialog and the Remove button are gone: focus the outcome.
  useEffect(() => {
    if (removed) document.getElementById(removedHeadingId)?.focus();
  }, [removed, removedHeadingId]);

  const shownDisplay = display ?? ownView?.display ?? null;
  const owner = useMemo(
    () =>
      ownView && !ownView.case && shownDisplay
        ? buildOwnerShare({
            verdictId: id,
            token: token ?? null,
            display: shownDisplay,
            suggestedA: ownView.suggested.a,
            nameMap: ownView.nameMap,
            lang: verdictLang(result),
            namesConfirmed: ownView.namesConfirmed || display !== null,
            onSaved: setDisplay,
          })
        : null,
    [ownView, shownDisplay, display, id, token, result],
  );

  if (removed) {
    // The "settle your own argument" block stays below it.
    return (
      <>
        <div className={cardClassName}>
          <RemovedVerdict lang={initialLang} headingLevel={1} headingId={removedHeadingId} cta={false} />
        </div>
        {cta}
      </>
    );
  }

  const selfParty = ownView?.case?.party === "b" ? "B" : "A";
  // The writer's own display name, as the share page shows it (names on).
  const selfDisplayName = shownDisplay?.namesVisible ? (selfParty === "A" ? shownDisplay.a : shownDisplay.b) : null;
  const langRow = (
    <div className={styles.langRow}>
      <span className={styles.langLabel} aria-hidden>
        {label}
      </span>
      <LangToggle lang={picked} onSelect={setPicked} label={label} />
    </div>
  );

  if (ownView) {
    return (
      <>
        <h1 className={kickerClassName}>{t(initialLang, "shared.ownKicker")}</h1>
        <Thread
          lang={initialLang}
          argument={ownView.originalStatus === "stored" ? (ownView.original?.text ?? null) : null}
          missing={ownView.originalStatus === "unreadable" ? "owner.unreadable" : "owner.notStored"}
          verdict={
            <div lang={lang} className="flex flex-col gap-4 min-w-0">
              {langRow}
              <VerdictView
                result={current.result}
                lang={lang}
                shareId={id}
                verdictId={roundId}
                nameMap={withRoundNames(ownView.nameMap, appeal.names)}
                selfParty={selfParty}
                viewerIsSelfParty={Boolean(ownView.case)}
                selfDisplayName={selfDisplayName}
                owner={owner && ownView.originalStatus === "stored" ? owner : undefined}
                onAddContext={appeal.onAddContext}
                focusAppeal={appeal.finished}
              />
            </div>
          }
          followUp={
            <div lang={lang} className="flex flex-col gap-6 min-w-0">
              {appeal.panel}
              <VerdictHistory
                lang={lang}
                verdicts={appeal.verdicts}
                linked={false}
                names={withRoundNames(ownView.nameMap, appeal.names) ?? []}
                selfParty="A"
                viewerIsSelfParty={false}
              />
              <OwnerPanel
                lang={lang}
                mine={ownView}
                token={token ?? null}
                owner={owner}
                signedIn={Boolean(viewer.me?.user)}
                onRemoved={() => setRemoved(true)}
              />
            </div>
          }
        />
        <NextSteps lang={initialLang} />
      </>
    );
  }

  return (
    <>
      <h1 className={kickerClassName}>
        {t(initialLang, publicNames && publicNames.length > 0 ? "shared.subtitle" : "shared.subtitleHidden")}
      </h1>
      {balance}
      <div className={cardClassName}>
        <div lang={lang} className="flex flex-col gap-4 min-w-0">
          {langRow}
          <VerdictView
            result={current.result}
            lang={lang}
            shareId={id}
            verdictId={roundId}
            nameMap={publicNames ?? undefined}
            publicNames
          />
        </div>
      </div>
      {cta}
    </>
  );
}
