"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { CaseView, RespondResponse } from "@/lib/case-types";
import { MAX_EVIDENCE_PER_SIDE } from "@/lib/case-types";
import { saveCaseNames, useCaseNames } from "@/lib/case-names-store";
import { getPreset } from "@/lib/frameworks";
import { apiErrorMessage, t, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import {
  clearPendingInvite,
  rememberPendingInvite,
  saveClaim,
  useClaim,
  usePendingInvite,
} from "@/lib/respondent-store";
import type { NameMapping } from "@/lib/types";
import { keyHolder, useCase } from "@/lib/use-case";
import { useViewer } from "@/lib/use-viewer";
import { JudgingOverlay } from "../JudgingOverlay";
import { Turnstile, TURNSTILE_SITE_KEY } from "../Turnstile";
import { VerdictView } from "../VerdictView";
import account from "../account/AccountPages.module.css";
import { AccountsRead } from "./AccountsRead";
import { AppealSection, useAppealDraft, type AppealDraft } from "./AppealForm";
import { CaseShell, VerdictHistory, useJudgingOverlay } from "./CaseScreen";
import { EvidencePicker, type EvidenceController, useEvidence } from "./EvidencePicker";
import styles from "./case.module.css";

/** Longest side the form accepts (the API enforces the same cap). */
export const MAX_SIDE = 6000;
const MIN_SIDE = 20;

/** Where the respondent's "Sign in to add context" goes. The token stays out
 * of it (sign-in e-mails and OAuth state carry `next`): the invite is kept in
 * this browser and /r picks it up again after sign-in. */
export const RESPOND_SIGNIN_HREF = `/signin?next=${encodeURIComponent("/r")}`;

/** What the respondent's page shows for a case view, decided purely from it. */
export type RespondStage =
  | "own_invite"
  | "form"
  | "judging"
  | "verdict"
  | "without_you"
  | "expired"
  | "closed"
  | "failed";

export function respondStage(view: CaseView): RespondStage {
  if (view.ownInvite) return "own_invite";
  switch (view.status) {
    case "awaiting_respondent":
      return view.respondentAnswered ? "closed" : "form";
    case "expired":
      return "expired";
    case "judging":
      if (view.mode === "one_sided") return "without_you";
      return view.respondentAnswered ? "judging" : "closed";
    case "judged":
      if (view.mode === "one_sided") return "without_you";
      return view.verdicts.length > 0 ? "verdict" : "closed";
    case "failed":
      if (view.mode === "one_sided") return "without_you";
      return view.respondentAnswered ? "failed" : "closed";
  }
}

export type RespondForm = {
  text: string;
  setText: (v: string) => void;
  evidence: EvidenceController;
  setTurnstile: (token: string | null) => void;
  /** Bumped to remount the human check with a fresh token. */
  turnstileKey: number;
  sending: boolean;
  error: string | null;
  canSubmit: boolean;
  submit: () => Promise<void>;
};

function useRespondForm(
  token: string,
  lang: Lang,
  onDone: (view: CaseView, names: NameMapping[], claim: string | null) => void,
): RespondForm {
  const [text, setText] = useState("");
  const [turnstile, setTurnstile] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evidence = useEvidence(`/api/v1/respond/${encodeURIComponent(token)}/evidence`, MAX_EVIDENCE_PER_SIDE);
  const keyFor = useMemo(() => keyHolder(), []);
  const needsCheck = TURNSTILE_SITE_KEY !== "";
  const trimmed = text.trim();
  const canSubmit =
    trimmed.length >= MIN_SIDE && !sending && !evidence.busy && (!needsCheck || turnstile !== null);

  async function submit() {
    if (!canSubmit) return;
    // Turnstile tokens are single-use: take it now; the widget remounts.
    const check = turnstile;
    setTurnstile(null);
    setSending(true);
    setError(null);
    const payload = { text: trimmed, ...(evidence.tokens.length ? { evidence: evidence.tokens } : {}) };
    try {
      const res = await fetch(`/api/v1/respond/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": keyFor(JSON.stringify(payload)) },
        body: JSON.stringify({ ...payload, ...(check ? { turnstileToken: check } : {}) }),
      });
      const json: unknown = await res.json().catch(() => null);
      const ok = json as RespondResponse | null;
      if (!res.ok || !ok?.case) {
        setError(apiErrorMessage(lang, json, res.status));
        setTurnstileKey((k) => k + 1);
        return;
      }
      evidence.clear();
      onDone(ok.case, ok.name_map ?? [], ok.respondent_claim ?? null);
    } catch {
      setError(t(lang, "errorFallback"));
      setTurnstileKey((k) => k + 1);
    } finally {
      setSending(false);
    }
  }

  return { text, setText, evidence, setTurnstile, turnstileKey, sending, error, canSubmit, submit };
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
  overlay: { done: boolean } | null;
  onOverlayFinished: () => void;
  fresh: boolean;
  appeal: AppealDraft | null;
  /** Rendered in place of the live human check (tests pass null). */
  turnstile?: ReactNode;
  /** Show the screenshot pickers (the deployment offers evidence). */
  evidence?: boolean;
};

/** Everything on the respondent's page below the title. Stateless, so tests
 * render every stage from a case view. */
export function RespondPanel({
  lang,
  view,
  token,
  names,
  form,
  overlay,
  onOverlayFinished,
  fresh,
  appeal,
  turnstile,
  evidence = true,
}: RespondPanelProps) {
  const fieldId = useId();
  const stage = respondStage(view);
  const current = view.verdicts.at(-1) ?? null;
  const ownSide = view.sides.filter((s) => s.party === view.yourParty);
  const preset = getPreset(view.framework.preset);

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

  if (stage === "form") {
    if (!form) return null;
    return (
      <>
        <ul className={styles.facts}>
          <li>{t(lang, "respond.framework", { preset: `${preset.emoji} ${t(lang, `preset.${preset.id}.label`)}` })}</li>
          <li>{t(lang, "respond.lang", { lang: t(lang, view.lang === "tr" ? "respond.lang.tr" : "respond.lang.en") })}</li>
        </ul>
        <form
          className={`${account.card} ${styles.stack}`}
          onSubmit={(e) => {
            e.preventDefault();
            void form.submit();
          }}
        >
          <div className={styles.field}>
            <label htmlFor={fieldId} className={styles.fieldLabel}>
              <span>{t(lang, "respond.label")}</span>
              <span className={styles.count} aria-hidden>
                {form.text.length} / {MAX_SIDE}
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
          <button type="submit" className={`${account.btn} ${account.primary}`} disabled={!form.canSubmit}>
            {form.sending ? t(lang, "case.creating") : t(lang, "respond.submit")}
          </button>
          <p className={styles.privacy}>
            <LockGlyph />
            <span>{t(lang, "respond.privacy")}</span>
          </p>
        </form>
      </>
    );
  }

  if (stage === "judging" || (overlay && stage === "verdict")) {
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

  if (stage === "failed") {
    return (
      <>
        <p className={styles.banner}>{t(lang, "respond.failed")}</p>
        <AccountsRead lang={lang} title={t(lang, "case.yourSide")} sides={ownSide} yourParty={view.yourParty} />
      </>
    );
  }

  // stage === "verdict"
  return (
    <>
      {current ? (
        <VerdictView
          result={current.result}
          nameMap={names}
          shareId={current.id}
          lang={lang}
          fresh={fresh}
          selfParty="B"
          viewerIsSelfParty
        />
      ) : null}
      <AppealSection
        lang={lang}
        view={view}
        signInHref={RESPOND_SIGNIN_HREF}
        onSignIn={() => rememberPendingInvite(token)}
        draft={appeal}
        evidence={evidence}
      />
      <VerdictHistory lang={lang} view={view} names={names} selfParty="B" />
      <AccountsRead
        lang={lang}
        title={t(lang, "case.accounts")}
        sides={view.sides}
        appeals={view.appeals}
        yourParty={view.yourParty}
      />
    </>
  );
}

/** /r/[token]: the invited person's page. No account needed to answer. */
export function RespondScreen({ token }: { token: string }) {
  const lang = useLang();
  const viewer = useViewer();
  const evidenceOn = viewer.config?.features?.evidence === true;
  // The claim secret (kept per case id) goes with every GET so the view can
  // say whether this person may add context. The id is only known once a
  // view has loaded, hence the remembered id.
  const [knownId, setKnownId] = useState<string | null>(null);
  const claim = useClaim(knownId);
  const { load, setView } = useCase(
    `/api/v1/respond/${encodeURIComponent(token)}`,
    claim ? { "Respondent-Claim": claim } : null,
  );
  const view = load.view;
  const caseId = view?.id ?? null;
  if (caseId !== null && caseId !== knownId) setKnownId(caseId);
  const names = useCaseNames(caseId, "b");
  const { overlay, fresh, finish } = useJudgingOverlay(view?.status ?? null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const form = useRespondForm(token, lang, (next, map, claimSecret) => {
    saveCaseNames(next.id, "b", map);
    saveClaim(next.id, claimSecret);
    setView(next);
  });
  const appeal = useAppealDraft({
    endpoint: `/api/v1/respond/${encodeURIComponent(token)}/appeals`,
    caseId: caseId ?? "",
    party: "b",
    lang,
    onView: setView,
    claim,
  });

  useEffect(() => {
    if (fresh) headingRef.current?.focus({ preventScroll: true });
  }, [fresh]);

  // Back from sign-in: the invite kept for the trip is no longer needed.
  useEffect(() => clearPendingInvite(token), [token]);

  const stage = view ? respondStage(view) : null;
  const answering = stage === "form";
  // "Your case" only once they took part; an invite that closed without
  // them stays neutral.
  const shut = stage === "expired" || stage === "closed" || stage === "without_you";
  const title = t(lang, answering || !view ? "respond.title" : shut ? "respond.inviteTitle" : "case.title");
  const kicker = t(lang, "respond.kicker");

  if (!view) {
    const message =
      load.status === "loading"
        ? t(lang, "respond.loading")
        : load.status === "missing"
          ? t(lang, "respond.notFound")
          : t(lang, "case.loadFailed");
    return (
      <CaseShell lang={lang} kicker={kicker} title={title}>
        <p className={load.status === "loading" ? styles.note : styles.error} role={load.status === "loading" ? "status" : "alert"}>
          {message}
        </p>
      </CaseShell>
    );
  }

  return (
    <CaseShell
      lang={lang}
      kicker={kicker}
      title={title}
      lead={answering ? t(lang, "respond.intro") : null}
      status={stage === "judging" || stage === "verdict" || stage === "failed" ? view.status : null}
      headingRef={headingRef}
    >
      <RespondPanel
        lang={lang}
        view={view}
        token={token}
        names={names}
        form={form}
        overlay={overlay}
        onOverlayFinished={finish}
        fresh={fresh}
        appeal={appeal}
        evidence={evidenceOn}
        turnstile={
          TURNSTILE_SITE_KEY !== "" && answering && !form.sending ? (
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
    <CaseShell lang={lang} kicker={t(lang, "respond.kicker")} title={t(lang, "respond.inviteTitle")}>
      <p className={styles.note} role={missing ? "alert" : "status"}>
        {t(lang, missing ? "respond.pendingMissing" : "respond.loading")}
      </p>
    </CaseShell>
  );
}
