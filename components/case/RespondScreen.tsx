"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { apiFetch, apiFetchAgreed } from "@/lib/api-fetch";
import type { AppealResponse, CaseRemovalResponse, CaseView, OpenResponse, RespondResponse } from "@/lib/case-types";
import { MAX_EVIDENCE_PER_SIDE } from "@/lib/case-types";
import { forgetCaseNames, saveCaseNames, useCaseNames } from "@/lib/case-names-store";
import { firstNameOf } from "@/lib/originals-types";
import { trackApiError } from "@/lib/analytics/client";
import { apiErrorMessage, languageName, t, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { langTag } from "@/lib/langs";
import type { SelfParty } from "@/lib/names";
import {
  clearPendingInvite,
  linkAllStoredClaims,
  linkStoredClaim,
  rememberPendingInvite,
  usePendingInvite,
} from "@/lib/respondent-store";
import type { NameMapping } from "@/lib/types";
import { keyHolder, useCase } from "@/lib/use-case";
import { refreshViewer, useViewer } from "@/lib/use-viewer";
import { JudgingOverlay } from "../JudgingOverlay";
import { loadAnswered } from "@/lib/history-store";
import { updateHistoryCase } from "../shell/useHistory";
import { Turnstile, TURNSTILE_SITE_KEY } from "../Turnstile";
import { VerdictView } from "../VerdictView";
import account from "../account/AccountPages.module.css";
import { AccountsRead } from "./AccountsRead";
import { AppealSection, useAppealDraft, useAppealFinished, type AppealDraft } from "./AppealForm";
import { CaseShell, useJudgingOverlay } from "./CaseScreen";
import { CaseNames, CaseOriginals, useCaseOriginals } from "./CaseOwnTools";
import { openConfirm } from "../account/AccountView";
import { signOutNow } from "../AccountMenu";
import { EvidencePicker, type EvidenceController, useEvidence } from "./EvidencePicker";
import { VerdictHistory } from "./VerdictHistory";
import styles from "./case.module.css";

/** Longest side the form accepts (the API enforces the same cap). */
export const MAX_SIDE = 6000;
const MIN_SIDE = 20;

/** Where the respondent's sign-in goes. The token stays out of it (sign-in
 * e-mails and OAuth state carry `next`): the invite is kept in this browser
 * and /r picks it up again after sign-in. */
export const RESPOND_SIGNIN_HREF = `/signin?next=${encodeURIComponent("/r")}`;

/** What the respondent's page shows for a case view, decided purely from it. */
export type RespondStage =
  | "own_invite"
  | "form"
  | "waiting"
  | "judging"
  | "verdict"
  | "without_you"
  | "expired"
  | "expired_answered"
  | "closed"
  | "failed";

export function respondStage(view: CaseView): RespondStage {
  if (view.ownInvite) return "own_invite";
  // Only the account that answered is spoken to as that side.
  const answered = view.respondentAnswered && view.inAccount === true;
  switch (view.status) {
    case "awaiting_respondent":
      return answered ? "waiting" : "form";
    case "expired":
      return answered ? "expired_answered" : "expired";
    case "judging":
      if (view.mode === "one_sided") return "without_you";
      return answered ? "judging" : "closed";
    case "judged":
      if (view.mode === "one_sided") return "without_you";
      return view.verdicts.length > 0 ? "verdict" : "closed";
    case "failed":
      if (view.mode === "one_sided") return "without_you";
      return answered ? "failed" : "closed";
  }
}

export type RespondForm = {
  text: string;
  setText: (v: string) => void;
  /** The name shown for them on the case's share pages (empty = Party B). */
  name: string;
  setName: (v: string) => void;
  evidence: EvidenceController;
  setTurnstile: (token: string | null) => void;
  /** Bumped to remount the human check with a fresh token. */
  turnstileKey: number;
  sending: boolean;
  error: string | null;
  /** The seat was lost and a new one taken: the text is kept, to be sent again. */
  moved: boolean;
  canSubmit: boolean;
  submit: () => Promise<void>;
};

/** Longest wait between heartbeats while someone types. */
const TYPING_BEAT_MS = 3000;

function useRespondForm(
  token: string,
  lang: Lang,
  onDone: (view: CaseView, names: NameMapping[]) => void,
  suggestedName: string | null,
  signedIn: boolean,
  shownParty: CaseView["yourParty"] | null,
  onSeatMoved: () => Promise<boolean | null>,
): RespondForm {
  const [text, setText] = useState("");
  const lastBeat = useRef(0);
  // The owner sees "typing" for a few seconds after the last beat; it carries nothing else.
  function typed(value: string) {
    setText(value);
    const now = Date.now();
    if (!signedIn || now - lastBeat.current < TYPING_BEAT_MS) return;
    lastBeat.current = now;
    void apiFetch(`/api/v1/respond/${encodeURIComponent(token)}/typing`, { method: "POST" }).catch(() => undefined);
  }
  const [typedName, setName] = useState<string | null>(null);
  const name = typedName ?? suggestedName ?? "";
  const [turnstile, setTurnstile] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const evidence = useEvidence(`/api/v1/respond/${encodeURIComponent(token)}/evidence`, MAX_EVIDENCE_PER_SIDE);
  const keyFor = useMemo(() => keyHolder(), []);
  const needsCheck = TURNSTILE_SITE_KEY !== "";
  const trimmed = text.trim();
  const canSubmit =
    trimmed.length >= MIN_SIDE &&
    !sending &&
    !evidence.busy &&
    (!needsCheck || turnstile !== null);

  async function submit() {
    if (!canSubmit) return;
    // Turnstile tokens are single-use: take it now; the widget remounts.
    const check = turnstile;
    setTurnstile(null);
    setSending(true);
    setError(null);
    setMoved(false);
    const shownName = name.trim();
    const payload = {
      text: trimmed,
      ...(evidence.tokens.length ? { evidence: evidence.tokens } : {}),
      ...(shownName ? { displayName: shownName } : {}),
    };
    try {
      const res = await apiFetchAgreed(`/api/v1/respond/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": keyFor(JSON.stringify(payload)),
        },
        body: JSON.stringify({ ...payload, ...(shownParty && shownParty !== "a" ? { party: shownParty } : {}), ...(check ? { turnstileToken: check } : {}) }),
      });
      const json: unknown = await res.json().catch(() => null);
      const ok = json as RespondResponse | null;
      if (!res.ok || !ok?.case) {
        // The side moved: take the page to the new one, keeping what was typed.
        const code = (json as { code?: unknown } | null)?.code;
        if (code === "seat_moved" && (await onSeatMoved())) {
          setMoved(true);
          return;
        }
        trackApiError(json, res.status);
        setError(apiErrorMessage(lang, json, res.status));
        setTurnstileKey((k) => k + 1);
        return;
      }
      evidence.clear();
      onDone(ok.case, ok.name_map ?? []);
    } catch {
      setError(t(lang, "errorFallback"));
      setTurnstileKey((k) => k + 1);
    } finally {
      setSending(false);
    }
  }

  return {
    text,
    setText: typed,
    name,
    setName,
    evidence,
    setTurnstile,
    turnstileKey,
    sending,
    error,
    moved,
    canSubmit,
    submit,
  };
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <rect x="3" y="7" width="10" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export type RespondPanelProps = {
  lang: Lang;
  view: CaseView;
  token: string;
  names: NameMapping[];
  form: RespondForm | null;
  /** Signed out: the form gives way to a sign-in button that keeps the invite for the way back. */
  signIn?: boolean;
  /** Signed in, seat not taken yet: the invite's facts and a button that takes it. */
  answerAs?: { name: string; busy: boolean; error: string | null; onAnswer: () => void; onSwitch: () => void };
  overlay: { done: boolean } | null;
  onOverlayFinished: () => void;
  fresh: boolean;
  appeal: AppealDraft | null;
  /** Rendered in place of the live human check (tests pass null). */
  turnstile?: ReactNode;
  /** Show the screenshot pickers (the deployment offers evidence). */
  evidence?: boolean;
  /** An appeal just finished: focus its outcome banner. */
  focusAppeal?: boolean;
  /** Their names and originals (rendered by the screen). */
  ownTools?: ReactNode;
  /** Removes their side (soft); absent when this browser cannot prove it is Party B. */
  onRemove?: () => void;
  /** They just removed their side. */
  removedNow?: boolean;
};

/** Everything on the respondent's page below the title. Stateless, so tests
 * render every stage from a case view. */
export function RespondPanel({
  lang,
  view,
  token,
  names,
  form,
  signIn = false,
  answerAs,
  overlay,
  onOverlayFinished,
  fresh,
  appeal,
  turnstile,
  evidence = true,
  focusAppeal = false,
  ownTools = null,
  onRemove,
  removedNow = false,
}: RespondPanelProps) {
  const fieldId = useId();
  const nameId = useId();
  const removeRef = useRef<HTMLDialogElement>(null);
  const removeCancelRef = useRef<HTMLButtonElement>(null);
  const stage = respondStage(view);
  const isParty = view.inAccount === true;
  const current = view.verdicts.at(-1) ?? null;
  const ownSide = isParty ? view.sides.filter((s) => s.party === view.yourParty) : [];
  // A bystander reads the verdict from the neutral side, as on a share page.
  const selfParty = (isParty ? view.yourParty.toUpperCase() : "A") as SelfParty;

  if (stage === "own_invite") {
    return <p className={styles.banner}>{t(lang, "respond.ownInvite")}</p>;
  }
  if (stage === "expired" || stage === "closed" || stage === "without_you") {
    // Not an error on their part: a calm note and somewhere to go next.
    const key = stage === "expired" ? "respond.expired" : stage === "closed" ? "respond.closed" : "respond.withoutYou";
    return (
      <>
        <p className={styles.calm} role="status">
          {t(lang, key)}
        </p>
        <AccountsRead lang={lang} title={t(lang, "case.yourSide")} sides={ownSide} yourParty={view.yourParty} />
        <div className={styles.stack}>
          <p className={styles.note}>{t(lang, "respond.startOwn")}</p>
          <Link href="/" className={`${account.btn} ${account.secondary}`}>
            {t(lang, "respond.startOwnCta")}
          </Link>
        </div>
      </>
    );
  }

  if (stage === "form" && signIn) {
    return (
      <>
        <ul className={styles.facts}>
          <li>{t(lang, "respond.lang", { lang: languageName(lang, view.lang) })}</li>
        </ul>
        <Link
          href={RESPOND_SIGNIN_HREF}
          onClick={() => rememberPendingInvite(token)}
          className={`${account.btn} ${account.primary}`}
        >
          {t(lang, "nav.signIn")}
        </Link>
      </>
    );
  }

  if (stage === "form" && answerAs) {
    return (
      <>
        <ul className={styles.facts}>
          <li>{t(lang, "respond.lang", { lang: languageName(lang, view.lang) })}</li>
        </ul>
        <div className={styles.stack}>
          <button type="button" className={`${account.btn} ${account.primary}`} disabled={answerAs.busy} onClick={answerAs.onAnswer}>
            {t(lang, "respond.answerAs", { name: answerAs.name })}
          </button>
          {answerAs.error ? (
            <p className={styles.error} role="alert">
              {answerAs.error}
            </p>
          ) : null}
          <button type="button" className={styles.textBtn} onClick={answerAs.onSwitch}>
            {t(lang, "respond.switchAccount")}
          </button>
        </div>
      </>
    );
  }

  if (stage === "form") {
    if (!form) return null;
    return (
      <>
        <ul className={styles.facts}>
          <li>{t(lang, "respond.lang", { lang: languageName(lang, view.lang) })}</li>
        </ul>
        <form
          className={`${account.card} ${styles.stack}`}
          onSubmit={(e) => {
            e.preventDefault();
            void form.submit();
          }}
        >
          {form.moved ? (
            <p className={styles.note} role="status">
              {t(lang, "respond.moved")}
            </p>
          ) : null}
          <div className={styles.field}>
            <label htmlFor={fieldId} className={styles.fieldLabel}>
              <span className="sr-only">{t(lang, "respond.label")}</span>
              <span className={styles.count} aria-hidden>
                {form.text.length.toLocaleString(langTag(lang))} / {MAX_SIDE.toLocaleString(langTag(lang))}
              </span>
            </label>
            <textarea
              id={fieldId}
              className={styles.textarea}
              value={form.text}
              onChange={(e) => form.setText(e.target.value)}
              placeholder={t(lang, "respond.placeholder")}
              maxLength={MAX_SIDE}
              minLength={MIN_SIDE}
              rows={6}
              required
              readOnly={form.sending}
              aria-describedby={form.error ? "respond-error" : undefined}
            />
          </div>
          {evidence ? (
            <EvidencePicker
              lang={lang}
              max={MAX_EVIDENCE_PER_SIDE}
              items={form.evidence.items}
              full={form.evidence.full}
              failure={form.evidence.failure}
              overLimit={form.evidence.overLimit}
              disabled={form.sending}
              onAdd={form.evidence.add}
              onRemove={form.evidence.remove}
            />
          ) : null}
          {turnstile !== undefined ? turnstile : null}
          {form.error ? (
            <p id="respond-error" className={styles.error} role="alert">
              {form.error}
            </p>
          ) : null}
          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor={nameId} className={styles.fieldLabel}>
                {t(lang, "case.displayName")}
              </label>
              <input
                id={nameId}
                className={account.input}
                value={form.name}
                maxLength={40}
                autoComplete="given-name"
                readOnly={form.sending}
                onChange={(e) => form.setName(e.target.value)}
              />
            </div>
            <button type="submit" className={`${account.btn} ${account.primary}`} disabled={!form.canSubmit}>
              {form.sending ? t(lang, "case.creating") : t(lang, "respond.submit")}
            </button>
          </div>
          <p className={styles.privacy}>
            <LockGlyph />
            <span>{t(lang, "respond.privacy")}</span>
          </p>
        </form>
      </>
    );
  }

  if (stage === "judging" || (isParty && overlay && stage === "verdict")) {
    return (
      <>
        <p className={styles.calm} role="status">
          {t(lang, "respond.sent")}
        </p>
        <div className={account.card}>
          <JudgingOverlay
            lang={lang}
            done={Boolean(overlay?.done)}
            result={overlay?.done ? (current?.result ?? null) : null}
            onFinished={onOverlayFinished}
            premium
          />
        </div>
        <AccountsRead lang={lang} title={t(lang, "case.yourSide")} sides={ownSide} yourParty={view.yourParty} />
      </>
    );
  }

  const removal =
    onRemove && !view.removed ? (
      <>
        <button
          type="button"
          className={`${styles.textBtn} ${styles.dangerText}`}
          onClick={() => openConfirm(removeRef.current, removeCancelRef.current)}
        >
          {t(lang, "respond.remove")}
        </button>
        <dialog ref={removeRef} className={account.dialog} aria-labelledby="remove-side-title">
          <h2 id="remove-side-title" className={account.dialogTitle}>
            {t(lang, "respond.remove")}
          </h2>
          <p className={account.dialogText}>{t(lang, "respond.remove.confirm")}</p>
          <div className={account.row}>
            <button
              type="button"
              className={`${account.btn} ${account.danger}`}
              onClick={() => {
                removeRef.current?.close();
                onRemove();
              }}
            >
              {t(lang, "case.remove.yes")}
            </button>
            <button
              ref={removeCancelRef}
              type="button"
              className={`${account.btn} ${account.secondary}`}
              onClick={() => removeRef.current?.close()}
            >
              {t(lang, "case.cancel")}
            </button>
          </div>
        </dialog>
      </>
    ) : null;
  const removedBanner = view.removed ? (
    <p className={styles.banner} role="status">
      {t(lang, removedNow ? "case.removed" : "case.removedBanner")}
    </p>
  ) : null;

  if (stage === "waiting") {
    return (
      <>
        {removedBanner}
        <p className={styles.calm} role="status">
          {t(lang, "respond.sentWaiting")}
        </p>
        {ownTools}
        {removal}
      </>
    );
  }

  if (stage === "expired_answered") {
    return (
      <>
        {removedBanner ?? (
          <p className={styles.calm} role="status">
            {t(lang, "respond.expired")}
          </p>
        )}
        {ownTools}
        {removal}
      </>
    );
  }

  if (stage === "failed") {
    return (
      <>
        {removedBanner}
        <p className={styles.banner}>{t(lang, "respond.failed")}</p>
        {ownTools}
        <AccountsRead lang={lang} title={t(lang, "case.yourSide")} sides={ownSide} yourParty={view.yourParty} />
        {removal}
      </>
    );
  }

  // stage === "verdict"
  return (
    <>
      {removedBanner}
      {current ? (
        <VerdictView
          result={current.result}
          nameMap={isParty ? names : []}
          shareId={view.removed ? undefined : current.id}
          lang={lang}
          fresh={fresh}
          selfParty={selfParty}
          viewerIsSelfParty={isParty}
          focusAppeal={focusAppeal}
        />
      ) : null}
      {isParty ? (
        <AppealSection
          lang={lang}
          view={view}
          signInHref={RESPOND_SIGNIN_HREF}
          onSignIn={() => rememberPendingInvite(token)}
          draft={appeal}
          evidence={evidence}
        />
      ) : null}
      <VerdictHistory
        lang={lang}
        verdicts={view.verdicts}
        linked={!view.removed}
        names={isParty ? names : []}
        selfParty={selfParty}
        viewerIsSelfParty={isParty}
      />
      {isParty ? ownTools : null}
      <AccountsRead
        lang={lang}
        title={t(lang, "case.accounts")}
        sides={view.sides}
        appeals={view.appeals}
        yourParty={isParty ? view.yourParty : undefined}
      />
      {isParty ? removal : null}
    </>
  );
}

/** /r/[token]: the invited person's page. Reading the invite needs no
 * account; opening it, and answering, do. */
export function RespondScreen({ token }: { token: string }) {
  const lang = useLang();
  const viewer = useViewer();
  const evidenceOn = viewer.config?.features?.evidence === true;
  const signedIn = Boolean(viewer.me?.user);
  const signedOut = viewer.status === "ready" && !signedIn;
  const { load, setView, reload, served } = useCase(`/api/v1/respond/${encodeURIComponent(token)}`, null);
  const view = load.view;
  const caseId = view?.id ?? null;
  const localNames = useCaseNames(caseId, view?.yourParty ?? "b");
  // The server's encrypted copy for the bound account; this browser's names
  // for older cases.
  const names = view?.names ?? localNames;
  const base = `/api/v1/respond/${encodeURIComponent(token)}`;
  const originals = useCaseOriginals(base, null, view?.yourOriginal === "stored");
  const [removedNow, setRemovedNow] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const canProve = view?.inAccount === true;
  const { overlay, fresh, finish } = useJudgingOverlay(view?.status ?? null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [full, setFull] = useState(false);
  // The seat is taken only when the person taps Answer, never by opening the link.
  const [seated, setSeated] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  // Takes the next open side for this account; the person is told when none is left.
  async function open(): Promise<boolean | null> {
    try {
      const res = await apiFetch(`${base}/open`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as OpenResponse | null;
      if (res.ok && json?.case) {
        setView(json.case);
        setSeated(true);
        return true;
      }
      if (res.status === 409) setFull(true);
      else setOpenError(apiErrorMessage(lang, json, res.status));
      return false;
    } catch {
      setOpenError(t(lang, "errorFallback"));
      return null;
    }
  }
  async function answer() {
    setOpening(true);
    setOpenError(null);
    await open();
    setOpening(false);
  }
  const form = useRespondForm(
    token,
    lang,
    (next, map) => {
      saveCaseNames(next.id, next.yourParty, map);
      setView(next);
    },
    firstNameOf(viewer.me?.user?.name),
    signedIn,
    view?.yourParty ?? null,
    open,
  );

  // An answer this browser gave signed out is linked to the account before
  // anything takes a seat, so the seat never becomes a second side. The case id
  // comes from this browser's record of the answer; the view's own id covers a
  // claim left without one.
  const linking = useRef(false);
  const checking = useRef<string | null>(null);
  const [linkDone, setLinkDone] = useState(false);
  const [claimChecked, setClaimChecked] = useState<string | null>(null);
  const [linkFailed, setLinkFailed] = useState(false);
  const [linkTry, setLinkTry] = useState(0);
  // The request made after a link succeeded: a view served before it is stale.
  const [reloadAt, setReloadAt] = useState<number | null>(null);
  function afterLink(out: Awaited<ReturnType<typeof linkStoredClaim>>, done: () => void) {
    if (out === "signed_out") {
      void refreshViewer().finally(() => setLinkFailed(true));
      return;
    }
    // Not settled (offline, server trouble): nothing opens until a retry settles it.
    if (out === "retry") {
      setLinkFailed(true);
      return;
    }
    setLinkFailed(false);
    if (out === "linked") setReloadAt(reload());
    done();
  }
  useEffect(() => {
    if (!signedIn || linking.current) return;
    linking.current = true;
    const rowId = loadAnswered().find((r) => r.inviteToken === token)?.id;
    if (!rowId) {
      void Promise.resolve().then(() => setLinkDone(true));
      return;
    }
    void linkStoredClaim(rowId).then((out) => afterLink(out, () => setLinkDone(true)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, token, linkTry]);
  useEffect(() => {
    if (!view || !signedIn || !linkDone || checking.current === view.id) return;
    checking.current = view.id;
    const id = view.id;
    void linkStoredClaim(id).then((out) => afterLink(out, () => setClaimChecked(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, signedIn, linkDone, linkTry]);
  // The invite answers "closed" to an old answerer whose record of the answer is gone:
  // every claim this browser holds is tried once, since the case id cannot be told.
  const swept = useRef(false);
  useEffect(() => {
    if (!signedIn || !linkDone || view || load.code !== "case_closed" || swept.current) return;
    swept.current = true;
    void linkAllStoredClaims().then((joined) => {
      if (joined) reload();
    });
  }, [signedIn, linkDone, view, load.code, reload]);
  function retryLink() {
    linking.current = false;
    checking.current = null;
    setLinkFailed(false);
    setLinkTry((n) => n + 1);
  }
  const awaitingReload = reloadAt !== null && served < reloadAt;
  const linkBlocked = signedIn && linkFailed;
  const linkReady = linkDone && view !== null && claimChecked === view.id && !awaitingReload;

  async function removeSide() {
    setRemoveError(null);
    try {
      const res = await apiFetch(`${base}/removal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "remove" }),
      });
      const json: unknown = await res.json().catch(() => null);
      const ok = json as CaseRemovalResponse | null;
      if (!res.ok || !ok?.case) {
        setRemoveError(apiErrorMessage(lang, json, res.status));
        return;
      }
      if (caseId) forgetCaseNames(caseId);
      setView(ok.case);
      setRemovedNow(true);
    } catch {
      setRemoveError(t(lang, "errorFallback"));
    }
  }
  // The Verdicts list follows this page, for the answer that is this account's.
  useEffect(() => {
    if (view?.inAccount === true) updateHistoryCase(view);
  }, [view]);

  const appeal = useAppealDraft<AppealResponse>({
    endpoint: `/api/v1/respond/${encodeURIComponent(token)}/appeals`,
    lang,
    onSent: (res) => {
      saveCaseNames(caseId ?? "", view?.yourParty ?? "b", res.name_map ?? []);
      setView(res.case);
    },
  });
  const appealFinished = useAppealFinished(view);

  useEffect(() => {
    if (fresh) headingRef.current?.focus({ preventScroll: true });
  }, [fresh]);

  // Back from sign-in: the invite kept for the trip is no longer needed.
  useEffect(() => clearPendingInvite(token), [token]);

  const stage = view ? respondStage(view) : null;
  const answering = stage === "form";
  // "Your case" only once they took part; an invite that closed without
  // them stays neutral.
  const bystander = view !== null && view.inAccount !== true && stage !== "own_invite";
  const shut = stage === "expired" || stage === "closed" || stage === "without_you" || bystander;
  const title = t(lang, answering || !view ? "respond.title" : shut ? "respond.inviteTitle" : "case.title");

  // Who is looking is not known yet, or could not be looked up: no form until it is.
  const viewerFailed = !signedIn && !signedOut && viewer.status === "error";
  const viewerPending = (!signedIn && !signedOut) || (signedIn && !linkBlocked && (!linkDone || (view !== null && !linkReady)));

  // Every side is taken: the link shows the case as full.
  if (!view || full || viewerPending || linkBlocked) {
    // A link that could not be settled is not a closed invite; the retry wins.
    const closed = !linkBlocked && (full || load.code === "case_closed");
    const message =
      load.status === "loading" || (viewerPending && !viewerFailed)
        ? t(lang, "respond.loading")
        : closed
          ? t(lang, "respond.closed")
          : load.status === "missing"
            ? t(lang, "respond.notFound")
            : t(lang, "case.loadFailed");
    const calm = load.status === "loading" || closed || (viewerPending && !viewerFailed);
    return (
      <CaseShell lang={lang} title={closed ? t(lang, "respond.inviteTitle") : title} bare>
        <p className={calm ? styles.note : styles.error} role={calm && !closed ? "status" : "alert"}>
          {message}
        </p>
        {(load.status === "error" || viewerFailed || linkBlocked) && !closed ? (
          <button
            type="button"
            className={`${account.btn} ${account.primary}`}
            onClick={() => (linkBlocked ? retryLink() : viewerFailed ? void refreshViewer() : reload())}
          >
            {t(lang, "case.retry")}
          </button>
        ) : null}
      </CaseShell>
    );
  }

  return (
    <CaseShell
      lang={lang}
      title={title}
      bare
      status={stage === "judging" || stage === "verdict" || stage === "failed" ? view.status : null}
      you={view.inAccount === true ? view.yourParty : undefined}
      headingRef={headingRef}
    >
      <RespondPanel
        lang={lang}
        view={view}
        token={token}
        names={names}
        form={form}
        signIn={signedOut}
        answerAs={
          signedIn && !seated
            ? {
                name: viewer.me?.user?.name?.trim() || viewer.me?.user?.email || "",
                busy: opening,
                error: openError,
                onAnswer: () => void answer(),
                onSwitch: () => void signOutNow(),
              }
            : undefined
        }
        overlay={overlay}
        onOverlayFinished={finish}
        fresh={fresh}
        appeal={appeal}
        focusAppeal={appealFinished}
        evidence={evidenceOn}
        removedNow={removedNow}
        onRemove={canProve && view.respondentAnswered ? () => void removeSide() : undefined}
        ownTools={
          <>
            {removeError ? (
              <p className={styles.error} role="alert">
                {removeError}
              </p>
            ) : null}
            <CaseOriginals lang={lang} data={view.removed ? null : originals} />
            {canProve && view.respondentAnswered && view.verdicts.length > 0 ? (
              <CaseNames
                lang={lang}
                view={view}
                base={base}
                onView={setView}
              />
            ) : null}
          </>
        }
        turnstile={
          TURNSTILE_SITE_KEY !== "" && answering && signedIn && !form.sending ? (
            <Turnstile key={form.turnstileKey} siteKey={TURNSTILE_SITE_KEY} lang={lang} onToken={form.setTurnstile} />
          ) : null
        }
      />
    </CaseShell>
  );
}

/** /r: where sign-in returns the respondent. The invite token was kept in
 * this browser (never in the sign-in link); this page takes it back and
 * opens the invite. */
export function PendingInviteScreen() {
  const lang = useLang();
  const router = useRouter();
  const pending = usePendingInvite();
  const missing = pending === null;
  useEffect(() => {
    // Left in storage until the invite page opens (it clears it), so this
    // page never flashes "open the link again" while navigating.
    if (pending) router.replace(`/r/${pending}`);
  }, [pending, router]);
  return (
    <CaseShell lang={lang} title={t(lang, "respond.inviteTitle")} bare>
      <p className={styles.note} role={missing ? "alert" : "status"}>
        {t(lang, missing ? "respond.pendingMissing" : "respond.loading")}
      </p>
    </CaseShell>
  );
}
