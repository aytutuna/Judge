"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import type { AppealResponse, CaseView, PartyLetter } from "@/lib/case-types";
import { MAX_APPEAL_CHARS, MAX_EVIDENCE_PER_APPEAL, MIN_APPEAL_CHARS } from "@/lib/case-types";
import { saveCaseNames } from "@/lib/case-names-store";
import { apiErrorMessage, t, tWithDate, type Lang } from "@/lib/i18n";
import { keyHolder } from "@/lib/use-case";
import { applyEntitlement, refreshViewer } from "@/lib/use-viewer";
import { PremiumSpark } from "../PremiumBadge";
import account from "../account/AccountPages.module.css";
import { EvidencePicker, useEvidence, type EvidenceController } from "./EvidencePicker";
import styles from "./case.module.css";

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
 * /api/v1/respond/{token}/appeals) with an Idempotency-Key, keep the
 * returned names in this browser, swap in the new case view (which is now
 * re-judging, so polling resumes) and the new balance. `claim` is the
 * respondent's claim secret from answering signed out, if this browser has it.
 */
export function useAppealDraft({
  endpoint,
  caseId,
  party,
  lang,
  onView,
  claim = null,
}: {
  endpoint: string;
  caseId: string;
  party: PartyLetter;
  lang: Lang;
  onView: (view: CaseView) => void;
  claim?: string | null;
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
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": keyFor(body) },
        body: claim ? JSON.stringify({ ...(JSON.parse(body) as object), claim }) : body,
      });
      const json: unknown = await res.json().catch(() => null);
      const ok = json as AppealResponse | null;
      if (!res.ok || !ok?.case) {
        setError(apiErrorMessage(lang, json, res.status));
        if (res.status === 401 || res.status === 402) void refreshViewer();
        return;
      }
      saveCaseNames(caseId, party, ok.name_map ?? []);
      if (ok.entitlement) applyEntitlement(ok.entitlement);
      setText("");
      evidence.clear();
      onView(ok.case);
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
  | { kind: "busy" };

export function appealArea(view: CaseView): AppealArea {
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
    case "busy":
      return { kind: "busy" };
    default:
      return { kind: "none" };
  }
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
}: {
  lang: Lang;
  view: CaseView;
  /** Where "Sign in to add context" goes (and comes back from). */
  signInHref: string;
  /** Runs before following the sign-in link (the respondent keeps the invite). */
  onSignIn?: () => void;
  draft: AppealDraft | null;
  /** Show the screenshot picker (the deployment offers evidence). */
  evidence?: boolean;
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
  if (area.kind === "busy" || area.kind === "used") {
    return <p className={styles.note}>{t(lang, area.kind === "busy" ? "appeal.busy" : "appeal.used")}</p>;
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
      <p className={styles.note}>{t(lang, "appeal.lead")}</p>
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
