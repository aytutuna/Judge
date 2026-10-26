"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import type { Entitlement } from "@/lib/account-types";
import type { CaseAppealView, CaseView } from "@/lib/case-types";
import { MAX_APPEAL_CHARS, MAX_EVIDENCE_PER_APPEAL, MIN_APPEAL_CHARS } from "@/lib/case-types";
import { apiErrorMessage, t, tWithDate, type Key, type Lang } from "@/lib/i18n";
import { keyHolder } from "@/lib/use-case";
import { applyEntitlement, refreshViewer } from "@/lib/use-viewer";
import { PremiumSpark } from "../PremiumBadge";
import account from "../account/AccountPages.module.css";
import { EvidencePicker, useEvidence, type EvidenceController } from "./EvidencePicker";
import styles from "./case.module.css";

/** What the appeal area reads: a case view, or the same shape built for a
 * one-sided verdict (VerdictAppeal). */
export type AppealSubject = Pick<CaseView, "status" | "role" | "yourParty" | "appeal"> & {
  appeals: readonly Pick<CaseAppealView, "party" | "status" | "error">[];
};

/**
 * True once an appeal that was being judged has finished (polling swapped in
 * a view with no appeal judging). The form that had keyboard focus is gone
 * by then, so the outcome banner takes focus instead of the document start.
 * Uses React's adjust-state-while-rendering pattern; false again while the
 * next appeal is judging.
 */
export function useAppealFinished(view: AppealSubject | null): boolean {
  const judging = view ? view.appeals.some((a) => a.status === "judging") : false;
  const [prev, setPrev] = useState(judging);
  const [finished, setFinished] = useState(false);
  if (judging !== prev) {
    setPrev(judging);
    setFinished(prev && !judging);
  }
  return finished;
}

/** Signed-in evidence uploads: an appeal is made by a signed-in account. */
export const APPEAL_EVIDENCE_ENDPOINT = "/api/v1/evidence";

export type AppealDraft = {
  text: string;
  setText: (v: string) => void;
  evidence: EvidenceController;
  sending: boolean;
  error: string | null;
  canSubmit: boolean;
  submit: () => Promise<void>;
};

/**
 * State and submission of one "add context" request: POST the appeal
 * endpoint (owner: /api/v1/cases/{id}/appeals; respondent:
 * /api/v1/respond/{token}/appeals; a one-sided verdict:
 * /api/v1/verdicts/{id}/appeals) with an Idempotency-Key, apply the new
 * balance and hand the answer to `onSent` (which keeps the names and swaps
 * in what is now re-judging). `claim` is the respondent's claim secret from
 * answering signed out, if this browser has it. `prepare` runs first and
 * throws to stop the request (keeping a verdict in the account).
 */
export function useAppealDraft<R extends { entitlement?: Entitlement }>({
  endpoint,
  lang,
  onSent,
  claim = null,
  prepare,
}: {
  endpoint: string;
  lang: Lang;
  onSent: (res: R) => void;
  claim?: string | null;
  prepare?: () => Promise<void>;
}): AppealDraft {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evidence = useEvidence(APPEAL_EVIDENCE_ENDPOINT, MAX_EVIDENCE_PER_APPEAL);
  const keyFor = useMemo(() => keyHolder(), []);
  const trimmed = text.trim();
  const canSubmit =
    trimmed.length >= MIN_APPEAL_CHARS && trimmed.length <= MAX_APPEAL_CHARS && !sending && !evidence.busy;

  async function submit() {
    if (!canSubmit) return;
    setSending(true);
    setError(null);
    const body = JSON.stringify({
      text: trimmed,
      ...(evidence.tokens.length ? { evidence: evidence.tokens } : {}),
    });
    try {
      if (prepare) await prepare();
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": keyFor(body) },
        body: claim ? JSON.stringify({ ...(JSON.parse(body) as object), claim }) : body,
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok || typeof json !== "object" || json === null) {
        setError(apiErrorMessage(lang, json, res.status));
        if (res.status === 401 || res.status === 402) void refreshViewer();
        return;
      }
      const ok = json as R;
      if (ok.entitlement) applyEntitlement(ok.entitlement);
      setText("");
      evidence.clear();
      onSent(ok);
    } catch {
      setError(t(lang, "errorFallback"));
    } finally {
      setSending(false);
    }
  }

  return { text, setText, evidence, sending, error, canSubmit, submit };
}

/** What the appeal area shows for a case view, decided purely from it. */
export type AppealArea =
  | { kind: "none" }
  | { kind: "judging" }
  | { kind: "form"; failed: "failed" | "refused" | null }
  | { kind: "upsell"; signIn: boolean }
  | { kind: "blocked"; reason: "no_credits" | "premium_required" | "fair_use" }
  | { kind: "used" }
  | { kind: "limit" }
  | { kind: "busy" };

export function appealArea(view: AppealSubject): AppealArea {
  if (view.status !== "judged") return { kind: "none" };
  const mine = view.appeals.find((a) => a.party === view.yourParty);
  if (view.appeals.some((a) => a.status === "judging")) {
    return mine?.status === "judging" ? { kind: "judging" } : { kind: "busy" };
  }
  if (view.appeal.allowed) {
    const failed = mine?.status === "failed" ? (mine.error === "refused" ? "refused" : "failed") : null;
    return { kind: "form", failed };
  }
  switch (view.appeal.blockedBy) {
    case "signin_required":
      return { kind: "upsell", signIn: true };
    case "premium_required":
    case "no_credits":
    case "fair_use":
      // The respondent reads it as an upsell; the owner already has an
      // account and sees why it is blocked.
      return view.role === "respondent"
        ? { kind: "upsell", signIn: false }
        : { kind: "blocked", reason: view.appeal.blockedBy };
    case "appeal_used":
      return { kind: "used" };
    case "appeal_limit":
      return { kind: "limit" };
    case "busy":
      return { kind: "busy" };
    default:
      return { kind: "none" };
  }
}

const NOTE_KEY = { busy: "appeal.busy", used: "appeal.used", limit: "appeal.limit" } as const satisfies Record<string, Key>;

/** Brings the appeal form into view and into focus (its text box when
 * there is one). */
export function focusAppealForm() {
  const section = document.querySelector<HTMLElement>('[aria-labelledby="appeal-title"]');
  const field = section?.querySelector("textarea") ?? null;
  if (!section) return;
  (field ?? section).scrollIntoView({ block: "center" });
  if (field) field.focus({ preventScroll: true });
}

const BLOCK_KEY = {
  no_credits: "error.no_credits",
  premium_required: "error.premium_required",
  fair_use: "error.fair_use",
} as const;

/** The appeal area: the "add context" form, its upsell, or why not. */
export function AppealSection({
  lang,
  view,
  signInHref,
  onSignIn,
  draft,
  evidence = true,
  lead = "appeal.lead",
}: {
  lang: Lang;
  view: AppealSubject;
  /** Where "Sign in to add context" goes (and comes back from). */
  signInHref: string;
  /** Runs before following the sign-in link (the respondent keeps the invite). */
  onSignIn?: () => void;
  draft: AppealDraft | null;
  /** Show the screenshot picker (the deployment offers evidence). */
  evidence?: boolean;
  /** The line under the form's title (a verdict takes two rounds). */
  lead?: Key;
}) {
  const fieldId = useId();
  const area = appealArea(view);
  if (area.kind === "none") return null;

  if (area.kind === "judging") {
    return (
      <p className={styles.calm} role="status">
        <span className={styles.spinner} aria-hidden /> {t(lang, "appeal.judging")}
      </p>
    );
  }
  if (area.kind === "busy" || area.kind === "used" || area.kind === "limit") {
    return <p className={styles.note}>{t(lang, NOTE_KEY[area.kind])}</p>;
  }
  if (area.kind === "upsell" || area.kind === "blocked") {
    return (
      <section className={account.card} aria-labelledby="appeal-title">
        <h2 id="appeal-title" className={styles.h2}>
          <PremiumSpark className={styles.spark} /> {t(lang, "appeal.title")}
        </h2>
        <p className={styles.note}>
          {area.kind === "upsell"
            ? t(lang, "appeal.upsell")
            : area.reason === "fair_use"
              ? tWithDate(lang, BLOCK_KEY.fair_use, null)
              : t(lang, BLOCK_KEY[area.reason])}
        </p>
        {area.kind === "upsell" && area.signIn ? (
          <Link href={signInHref} onClick={onSignIn} className={`${account.btn} ${account.primary}`}>
            {t(lang, "appeal.signIn")}
          </Link>
        ) : (
          <Link href="/pricing" className={`${account.btn} ${account.secondary}`}>
            {t(lang, "tier.getPremium")}
          </Link>
        )}
      </section>
    );
  }

  if (!draft) return null;
  const count = draft.text.length;
  return (
    <section className={account.card} aria-labelledby="appeal-title">
      <h2 id="appeal-title" className={styles.h2}>
        {t(lang, "appeal.title")}
      </h2>
      <p className={styles.note}>{t(lang, lead)}</p>
      {area.failed ? (
        <p className={styles.banner}>{t(lang, area.failed === "refused" ? "appeal.refused" : "appeal.failed")}</p>
      ) : null}
      <form
        className={styles.stack}
        onSubmit={(e) => {
          e.preventDefault();
          void draft.submit();
        }}
      >
        <div className={styles.field}>
          <label htmlFor={fieldId} className={styles.fieldLabel}>
            <span>{t(lang, "appeal.label")}</span>
            <span className={styles.count} aria-hidden>
              {count} / {MAX_APPEAL_CHARS}
            </span>
          </label>
          <textarea
            id={fieldId}
            className={`${styles.textarea} ${styles.short}`}
            value={draft.text}
            onChange={(e) => draft.setText(e.target.value)}
            placeholder={t(lang, "appeal.placeholder")}
            maxLength={MAX_APPEAL_CHARS}
            minLength={MIN_APPEAL_CHARS}
            rows={4}
            readOnly={draft.sending}
            aria-describedby={draft.error ? "appeal-error" : undefined}
          />
        </div>
        {evidence ? (
          <EvidencePicker
            lang={lang}
            max={MAX_EVIDENCE_PER_APPEAL}
            items={draft.evidence.items}
            full={draft.evidence.full}
            failure={draft.evidence.failure}
            overLimit={draft.evidence.overLimit}
            disabled={draft.sending}
            onAdd={draft.evidence.add}
            onRemove={draft.evidence.remove}
          />
        ) : null}
        {draft.error ? (
          <p id="appeal-error" className={styles.error} role="alert">
            {draft.error}
          </p>
        ) : null}
        <button type="submit" className={`${account.btn} ${account.primary}`} disabled={!draft.canSubmit}>
          {draft.sending ? t(lang, "appeal.sending") : t(lang, "appeal.submit")}
        </button>
      </form>
    </section>
  );
}
