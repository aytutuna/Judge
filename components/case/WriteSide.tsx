"use client";

import { useId, useMemo, useState } from "react";
import type { SideResponse } from "@/lib/case-types";
import { MAX_EVIDENCE_PER_SIDE } from "@/lib/case-types";
import { trackApiError } from "@/lib/analytics/client";
import { apiErrorMessage, t, type Lang } from "@/lib/i18n";
import { langTag } from "@/lib/langs";
import { MAX_ARGUMENT } from "@/lib/sides";
import { keyHolder } from "@/lib/use-case";
import { applyEntitlement, refreshViewer } from "@/lib/use-viewer";
import account from "../account/AccountPages.module.css";
import { EvidencePicker, useEvidence, type EvidenceController } from "./EvidencePicker";
import styles from "./case.module.css";

const MIN_SIDE = 20;

export type SideDraft = {
  text: string;
  setText: (v: string) => void;
  evidence: EvidenceController;
  sending: boolean;
  error: string | null;
  canSubmit: boolean;
  submit: () => Promise<void>;
};

/** State and submission of the owner's side on a case started without one:
 * POST /api/v1/cases/{id}/side with an Idempotency-Key. */
export function useSideDraft({
  endpoint,
  lang,
  onSent,
}: {
  endpoint: string;
  lang: Lang;
  onSent: (res: SideResponse) => void;
}): SideDraft {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evidence = useEvidence("/api/v1/evidence", MAX_EVIDENCE_PER_SIDE);
  const keyFor = useMemo(() => keyHolder(), []);
  const trimmed = text.trim();
  const canSubmit = trimmed.length >= MIN_SIDE && trimmed.length <= MAX_ARGUMENT && !sending && !evidence.busy;

  async function submit() {
    if (!canSubmit) return;
    setSending(true);
    setError(null);
    const body = JSON.stringify({ text: trimmed, ...(evidence.tokens.length ? { evidence: evidence.tokens } : {}) });
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": keyFor(body) },
        body,
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok || typeof json !== "object" || json === null) {
        trackApiError(json, res.status);
        setError(apiErrorMessage(lang, json, res.status));
        if (res.status === 401 || res.status === 402) void refreshViewer();
        return;
      }
      const ok = json as SideResponse;
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

/** The owner's form for writing their side after the link was sent. */
export function WriteSide({
  lang,
  draft,
  answered,
  evidenceOn,
}: {
  lang: Lang;
  draft: SideDraft;
  /** The other person already wrote theirs. */
  answered: boolean;
  evidenceOn: boolean;
}) {
  const fieldId = useId();
  return (
    <section className={account.card} aria-labelledby="write-title">
      <h2 id="write-title" className={styles.h2}>
        {t(lang, "case.write.title")}
      </h2>
      <p className={styles.note}>{t(lang, answered ? "case.write.leadAnswered" : "case.write.lead")}</p>
      <form
        className={styles.stack}
        onSubmit={(e) => {
          e.preventDefault();
          void draft.submit();
        }}
      >
        <div className={styles.field}>
          <label htmlFor={fieldId} className={styles.fieldLabel}>
            <span>{t(lang, "case.write.title")}</span>
            <span className={styles.count} aria-hidden>
              {draft.text.length.toLocaleString(langTag(lang))} / {MAX_ARGUMENT.toLocaleString(langTag(lang))}
            </span>
          </label>
          <textarea
            id={fieldId}
            className={styles.textarea}
            value={draft.text}
            onChange={(e) => draft.setText(e.target.value)}
            placeholder={t(lang, "case.write.placeholder")}
            maxLength={MAX_ARGUMENT}
            minLength={MIN_SIDE}
            rows={6}
            readOnly={draft.sending}
            aria-describedby={draft.error ? "write-error" : undefined}
          />
        </div>
        {evidenceOn ? (
          <EvidencePicker
            lang={lang}
            max={MAX_EVIDENCE_PER_SIDE}
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
          <p id="write-error" className={styles.error} role="alert">
            {draft.error}
          </p>
        ) : null}
        <button type="submit" className={`${account.btn} ${account.primary}`} disabled={!draft.canSubmit}>
          {draft.sending ? t(lang, "case.creating") : t(lang, "case.write.submit")}
        </button>
      </form>
    </section>
  );
}
