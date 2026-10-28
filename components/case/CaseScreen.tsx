"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  AppealResponse,
  CaseRemovalResponse,
  CaseResponse,
  CaseStatus,
  CaseView,
  InviteResponse,
  PartyLetter,
} from "@/lib/case-types";
import { forgetCaseNames, saveCaseNames, useCaseNames } from "@/lib/case-names-store";
import { apiErrorMessage, t, tWithDate, type Key, type Lang } from "@/lib/i18n";
import { langDir } from "@/lib/langs";
import { useLang } from "@/lib/lang";
import { localizeLabels, resolveParties, restoreNames, textLang } from "@/lib/names";
import type { NameMapping } from "@/lib/types";
import { useCase } from "@/lib/use-case";
import { refreshViewer, useViewer } from "@/lib/use-viewer";
import { JudgingOverlay } from "../JudgingOverlay";
import { SiteFooter, SiteHeader, SkipLink } from "../SiteChrome";
import { AppShell } from "../shell/AppShell";
import { updateHistoryCase } from "../shell/useHistory";
import { NextSteps } from "../thread/Composer";
import { Thread } from "../thread/Thread";
import { VerdictView } from "../VerdictView";
import { openConfirm } from "../account/AccountView";
import account from "../account/AccountPages.module.css";
import { AccountsRead } from "./AccountsRead";
import {
  AppealSection,
  appealArea,
  focusAppealForm,
  useAppealDraft,
  useAppealFinished,
  type AppealDraft,
} from "./AppealForm";
import { CaseNames, CaseOriginals, useCaseOriginals } from "./CaseOwnTools";
import { InviteLink } from "./InviteLink";
import { VerdictHistory } from "./VerdictHistory";
import styles from "./case.module.css";

const STATUS_KEY = {
  awaiting_respondent: "case.status.awaiting",
  judging: "case.status.judging",
  judged: "case.status.judged",
  failed: "case.status.failed",
  expired: "case.status.expired",
} as const satisfies Record<CaseStatus, Key>;

export function StatusChip({ lang, status }: { lang: Lang; status: CaseStatus }) {
  return (
    <span className={styles.status} data-status={status}>
      <span className={styles.statusDot} aria-hidden />
      {t(lang, STATUS_KEY[status])}
    </span>
  );
}

/** Chrome shared by the owner's and the respondent's case pages. The
 * owner's page sits in the app shell; the respondent's (`bare`) keeps the
 * plain header and footer: it is someone else's case. `you` (the viewer's
 * party) puts their side in green on everything inside. */
export function CaseShell({
  lang,
  kicker,
  title,
  lead,
  status,
  you,
  bare = false,
  children,
  headingRef,
}: {
  lang: Lang;
  kicker: string;
  title: string;
  lead?: string | null;
  status?: CaseStatus | null;
  you?: PartyLetter;
  bare?: boolean;
  children: ReactNode;
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  const main = (
    <main id="main" tabIndex={-1} className={styles.main} data-you={you}>
      <div className={`wrap ${styles.column}`}>
        <header className={styles.intro}>
          <p className="kicker">{kicker}</p>
          <h1 ref={headingRef} tabIndex={-1} className={styles.h1}>
            {title}
          </h1>
          {status ? <StatusChip lang={lang} status={status} /> : null}
          {lead ? <p className={styles.lead}>{lead}</p> : null}
        </header>
        {children}
      </div>
    </main>
  );
  if (!bare) {
    return (
      <AppShell lang={lang} toggle>
        {main}
      </AppShell>
    );
  }
  return (
    <div lang={lang} dir={langDir(lang)} className="contents">
      <SkipLink lang={lang} />
      <SiteHeader lang={lang} toggle />
      {main}
      <SiteFooter lang={lang} toggle />
    </div>
  );
}

/** A confirm dialog opened with focus on the safe choice. */
function Confirm({
  id,
  dialogRef,
  cancelRef,
  title,
  text,
  yes,
  danger = false,
  lang,
  onYes,
}: {
  id: string;
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  cancelRef: React.RefObject<HTMLButtonElement | null>;
  title: string;
  text: string;
  yes: string;
  danger?: boolean;
  lang: Lang;
  onYes: () => void;
}) {
  return (
    <dialog ref={dialogRef} className={account.dialog} aria-labelledby={id}>
      <h2 id={id} className={account.dialogTitle}>
        {title}
      </h2>
      <p className={account.dialogText}>{text}</p>
      <div className={account.row}>
        <button
          type="button"
          className={`${account.btn} ${danger ? account.danger : account.primary}`}
          onClick={() => {
            dialogRef.current?.close();
            onYes();
          }}
        >
          {yes}
        </button>
        <button
          ref={cancelRef}
          type="button"
          className={`${account.btn} ${account.secondary}`}
          onClick={() => dialogRef.current?.close()}
        >
          {t(lang, "case.cancel")}
        </button>
      </div>
    </dialog>
  );
}

export type CasePanelProps = {
  lang: Lang;
  view: CaseView;
  /** Party A's names: the server's copy (case.names), else this browser's. */
  names: NameMapping[];
  /** The judging animation is showing (status judging, or just finished). */
  overlay: { done: boolean } | null;
  onOverlayFinished: () => void;
  /** The verdict just replaced the judging card: ring it once. */
  fresh: boolean;
  busy: boolean;
  actionError: string | null;
  resetDone: boolean;
  onJudgeNow: () => void;
  onRetry: () => void;
  onReset: () => void;
  /** Removes the owner's side (soft: blanked and links closed). */
  onRemove: () => void;
  appeal: AppealDraft | null;
  /** Show the screenshot picker on the appeal form (the deployment offers evidence). */
  evidenceOn?: boolean;
  /** An appeal just finished: focus its outcome banner. */
  focusAppeal?: boolean;
  /** The owner's names and originals (rendered by the screen). */
  ownTools?: ReactNode;
  /** The owner just removed the case. */
  removedNow?: boolean;
  /** The owner's side as they wrote it, once this browser has read it. */
  ownText?: string | null;
};

/** The owner's side as the judges read it, with every name but the
 * narrator's put back ("you" would read oddly in a first-person account):
 * shown until the original text is loaded, or when it is not kept. */
export function ownSideText(text: string, names: NameMapping[]): string {
  const lang = textLang(text);
  const parties = resolveParties(names, lang, "A");
  for (const [letter, party] of parties) if (party.self) parties.delete(letter);
  return restoreNames(localizeLabels(text, lang), parties, lang);
}

/** Everything on the owner's case page below the title, from one case view:
 * the case as a thread (their side, then the invite, the judging or the
 * verdict, then the appeal), the record and the case tools under it, and
 * the docked next steps. Stateless apart from the confirm dialogs, so tests
 * render every state. */
export function CasePanel({
  lang,
  view,
  names,
  overlay,
  onOverlayFinished,
  fresh,
  busy,
  actionError,
  resetDone,
  onJudgeNow,
  onRetry,
  onReset,
  onRemove,
  appeal,
  evidenceOn = true,
  focusAppeal = false,
  ownTools = null,
  removedNow = false,
  ownText = null,
}: CasePanelProps) {
  const judgeRef = useRef<HTMLDialogElement>(null);
  const judgeCancelRef = useRef<HTMLButtonElement>(null);
  const resetRef = useRef<HTMLDialogElement>(null);
  const resetCancelRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLDialogElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);

  const current = view.verdicts.at(-1) ?? null;
  const appealJudging = view.appeals.some((a) => a.status === "judging");
  const canRemove = view.status !== "judging" && !appealJudging && !view.removed;
  const ownSide = view.sides.filter((s) => s.party === view.yourParty);
  const bothRead = view.sides.length > 1;
  // Cases from before every verdict was premium hold no unit.
  const held = view.tier === "premium";

  const error = actionError ? (
    <p className={styles.error} role="alert">
      {actionError}
    </p>
  ) : null;

  const own = view.sides.find((side) => side.party === view.yourParty);
  const argument = ownText ?? (own && !own.removed ? ownSideText(own.text, names) : null);
  const judged = !overlay && view.status === "judged" && current !== null;

  let invite: ReactNode = null;
  let notice: ReactNode = null;
  if (!overlay && view.status === "awaiting_respondent") {
    invite = (
      <div className={styles.stack}>
        <p className={styles.note}>{t(lang, "case.notYet")}</p>
        <section className={account.card}>
          {view.inviteUrl ? (
            <InviteLink
              lang={lang}
              url={view.inviteUrl}
              expiresAt={view.expiresAt}
              onReset={() => openConfirm(resetRef.current, resetCancelRef.current)}
              resetting={busy}
              resetDone={resetDone}
            />
          ) : null}
          {held ? <p className={styles.note}>{tWithDate(lang, "case.held", view.expiresAt)}</p> : null}
        </section>
        {error}
        {view.canJudgeNow ? (
          <button
            type="button"
            className={`${account.btn} ${account.secondary}`}
            disabled={busy}
            onClick={() => openConfirm(judgeRef.current, judgeCancelRef.current)}
          >
            {t(lang, "case.judgeNow")}
          </button>
        ) : null}
      </div>
    );
  } else if (!overlay && view.status === "failed") {
    notice = (
      <>
        <p className={styles.banner} role="status">
          {view.lastError === "quota" ? t(lang, "error.quota") : t(lang, held ? "case.failedBody" : "case.failedBodyFree")}
        </p>
        {error}
        <button type="button" className={`${account.btn} ${account.primary}`} disabled={busy} onClick={onRetry}>
          {t(lang, "case.retry")}
        </button>
      </>
    );
  } else if (!overlay && view.status === "expired") {
    notice = (
      <>
        <p className={styles.banner}>{t(lang, held ? "case.expiredBody" : "case.expiredBodyFree")}</p>
        {error}
        <div className={styles.row}>
          {view.canJudgeNow ? (
            <button
              type="button"
              className={`${account.btn} ${account.primary}`}
              disabled={busy}
              onClick={() => openConfirm(judgeRef.current, judgeCancelRef.current)}
            >
              {t(lang, "case.judgeNow")}
            </button>
          ) : null}
          <Link href="/" className={`${account.btn} ${account.secondary}`}>
            {t(lang, "case.startOver")}
          </Link>
        </div>
      </>
    );
  }
  const removedBanner = view.removed ? (
    <p className={styles.banner} role="status">
      {t(lang, removedNow ? "case.removed" : "case.removedBanner")}
    </p>
  ) : null;

  const judgingNote = overlay ? t(lang, view.respondentAnswered ? "case.answered" : "case.judgingAlone") : null;

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {judgingNote}
      </p>
      <Thread
        lang={lang}
        argument={argument}
        status={judgingNote}
        judging={
          overlay ? (
            <JudgingOverlay
              lang={lang}
              done={overlay.done}
              result={overlay.done ? (current?.result ?? null) : null}
              onFinished={onOverlayFinished}
              premium
            />
          ) : null
        }
        invite={invite}
        notice={
          removedBanner || notice ? (
            <div className={styles.stack}>
              {removedBanner}
              {notice}
            </div>
          ) : null
        }
        verdict={
          judged ? (
            <div className={styles.stack}>
              {view.mode === "one_sided" ? <p className={styles.note}>{t(lang, "case.oneSided")}</p> : null}
              <VerdictView
                result={current.result}
                nameMap={names}
                shareId={view.removed ? undefined : current.id}
                lang={lang}
                fresh={fresh}
                selfParty="A"
                viewerIsSelfParty
                focusAppeal={focusAppeal}
              />
            </div>
          ) : null
        }
        followUp={
          judged ? (
            <>
              <AppealSection
                lang={lang}
                view={view}
                signInHref={`/signin?next=${encodeURIComponent(`/c/${view.id}`)}`}
                draft={appeal}
                evidence={evidenceOn}
              />
              <VerdictHistory
                lang={lang}
                verdicts={view.verdicts}
                linked={!view.removed}
                names={names}
                selfParty="A"
              />
            </>
          ) : null
        }
      />
      {ownTools}
      <AccountsRead
        lang={lang}
        title={t(lang, bothRead ? "case.accounts" : "case.yourSide")}
        sides={bothRead ? view.sides : ownSide}
        appeals={bothRead || view.mode === "one_sided" ? view.appeals : []}
        yourParty={view.yourParty}
      />
      {canRemove ? (
        <button
          type="button"
          className={`${styles.textBtn} ${styles.dangerText}`}
          disabled={busy}
          onClick={() => openConfirm(deleteRef.current, deleteCancelRef.current)}
        >
          {t(lang, "case.remove")}
        </button>
      ) : null}
      {(view.status === "awaiting_respondent" || view.status === "expired") && view.canJudgeNow ? (
        // Waiting: the held unit pays and the invite closes. Expired: the
        // held unit went back, so a new one is spent; the dialog says so.
        <Confirm
          id="judge-now-title"
          dialogRef={judgeRef}
          cancelRef={judgeCancelRef}
          title={t(lang, "case.judgeNow")}
          text={t(lang, view.status === "expired" ? "case.judgeExpired.confirm" : "case.judgeNow.confirm")}
          yes={t(lang, view.status === "expired" ? "case.judgeExpired.yes" : "case.judgeNow.yes")}
          lang={lang}
          onYes={onJudgeNow}
        />
      ) : null}
      {view.status === "awaiting_respondent" && view.inviteUrl ? (
        <Confirm
          id="reset-invite-title"
          dialogRef={resetRef}
          cancelRef={resetCancelRef}
          title={t(lang, "case.invite.reset")}
          text={t(lang, "case.invite.resetConfirm")}
          yes={t(lang, "case.invite.resetYes")}
          lang={lang}
          onYes={onReset}
        />
      ) : null}
      {canRemove ? (
        <Confirm
          id="remove-case-title"
          dialogRef={deleteRef}
          cancelRef={deleteCancelRef}
          title={t(lang, "case.remove")}
          text={t(lang, "case.remove.confirm")}
          yes={t(lang, "case.remove.yes")}
          danger
          lang={lang}
          onYes={onRemove}
        />
      ) : null}
      <NextSteps lang={lang}>
        {judged && appeal && appealArea(view).kind === "form" ? (
          <button type="button" onClick={focusAppealForm}>
            {t(lang, "appeal.title")}
          </button>
        ) : null}
      </NextSteps>
    </>
  );
}

/** Tracks the judging animation across polls: it shows while the case is
 * judging and, once the verdict lands, finishes its reveal before the
 * verdict takes over. A page opened on a finished case skips it. */
export function useJudgingOverlay(status: CaseStatus | null): {
  overlay: { done: boolean } | null;
  fresh: boolean;
  finish: () => void;
} {
  const [shown, setShown] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [prev, setPrev] = useState<CaseStatus | null>(status);
  if (status !== prev) {
    // Adjusting state while rendering (React's documented pattern for
    // deriving from a changed prop): start the overlay when judging begins.
    setPrev(status);
    if (status === "judging") setShown(true);
    else if (status !== "judged") setShown(false);
  }
  if (status === "judging" && !shown) setShown(true);
  return {
    overlay: shown ? { done: status === "judged" } : null,
    fresh,
    finish: () => {
      setShown(false);
      setFresh(true);
    },
  };
}

/** /c/[id]: the owner's case page. */
export function CaseScreen({ id }: { id: string }) {
  const lang = useLang();
  const viewer = useViewer();
  const base = `/api/v1/cases/${encodeURIComponent(id)}`;
  const { load, setView } = useCase(base);
  const localNames = useCaseNames(id, "a");
  const view = load.view;
  // The server's encrypted copy, on any device; this browser's names for
  // cases created before it existed.
  const names = view?.names ?? localNames;
  const originals = useCaseOriginals(base, null, view?.yourOriginal === "stored");
  const { overlay, fresh, finish } = useJudgingOverlay(view?.status ?? null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);
  const [removedNow, setRemovedNow] = useState(false);
  const appeal = useAppealDraft<AppealResponse>({
    endpoint: `${base}/appeals`,
    lang,
    onSent: (res) => {
      saveCaseNames(id, "a", res.name_map ?? []);
      setView(res.case);
    },
  });
  const appealFinished = useAppealFinished(view);

  // The Verdicts list shows this case's status and headline: judging, a reply
  // or a removal seen here updates its row.
  useEffect(() => {
    if (view) updateHistoryCase(view);
  }, [view]);

  async function post(path: string, init: RequestInit): Promise<unknown | null> {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`${base}${path}`, init);
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(apiErrorMessage(lang, json, res.status));
        if (res.status === 401 || res.status === 402) void refreshViewer();
        return null;
      }
      return json;
    } catch {
      setActionError(t(lang, "errorFallback"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function judge(onlyMine: boolean) {
    const json = (await post("/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(onlyMine ? { mode: "only_mine" } : {}),
    })) as CaseResponse | null;
    if (json?.case) setView(json.case);
  }

  async function reset() {
    setResetDone(false);
    const json = (await post("/invite", { method: "POST" })) as InviteResponse | null;
    if (json?.inviteUrl && view) {
      setView({ ...view, inviteUrl: json.inviteUrl });
      setResetDone(true);
    }
  }

  async function remove() {
    const json = (await post("/removal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "remove" }),
    })) as CaseRemovalResponse | null;
    if (json?.case) {
      forgetCaseNames(id);
      setView(json.case);
      setRemovedNow(true);
    }
  }

  const title = t(lang, "case.title");
  // A case judged on the owner's side alone is not "both sides" anymore.
  const kicker = t(lang, view?.mode === "one_sided" ? "case.kickerOneSided" : "case.kicker");

  if (!view) {
    const message =
      load.status === "loading"
        ? t(lang, "case.loading")
        : load.status === "missing"
          ? t(lang, "case.notFound")
          : load.status === "signin"
            ? t(lang, "case.signIn")
            : t(lang, "case.loadFailed");
    return (
      <CaseShell lang={lang} kicker={kicker} title={title}>
        <p className={load.status === "error" ? styles.error : styles.note} role={load.status === "loading" ? "status" : "alert"}>
          {message}
        </p>
        {load.status === "signin" ? (
          <Link href={`/signin?next=${encodeURIComponent(`/c/${id}`)}`} className={`${account.btn} ${account.primary}`}>
            {t(lang, "nav.signIn")}
          </Link>
        ) : null}
      </CaseShell>
    );
  }

  return (
    <CaseShell lang={lang} kicker={kicker} title={title} status={view.status} you={view.yourParty}>
      <CasePanel
        lang={lang}
        view={view}
        names={names}
        overlay={overlay}
        onOverlayFinished={finish}
        fresh={fresh}
        busy={busy}
        actionError={actionError}
        resetDone={resetDone}
        onJudgeNow={() => void judge(true)}
        onRetry={() => void judge(false)}
        onReset={() => void reset()}
        onRemove={() => void remove()}
        appeal={appeal}
        evidenceOn={viewer.config?.features?.evidence === true}
        focusAppeal={appealFinished}
        removedNow={removedNow}
        ownText={view.removed ? null : (originals?.side.original?.text ?? null)}
        ownTools={
          <>
            <CaseOriginals lang={lang} data={view.removed ? null : originals} />
            {view.verdicts.length > 0 ? <CaseNames lang={lang} view={view} base={base} onView={setView} /> : null}
          </>
        }
      />
    </CaseShell>
  );
}
