"use client";

import { useEffect, useId, useState } from "react";
import type { CaseResponse, CaseView } from "@/lib/case-types";
import { apiErrorMessage, t, type Lang } from "@/lib/i18n";
import type { CaseOriginalsResponse } from "@/lib/originals-types";
import { OriginalDisclosure } from "../OwnerTools";
import account from "../account/AccountPages.module.css";
import styles from "./case.module.css";

/** This party's originals (GET <base>/originals), once the view says one is stored. */
export function useCaseOriginals(
  base: string,
  headers: Record<string, string> | null,
  enabled: boolean,
): CaseOriginalsResponse | null {
  const [data, setData] = useState<CaseOriginalsResponse | null>(null);
  const headerKey = headers ? JSON.stringify(headers) : "";
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    void (async () => {
      try {
        const extra = headerKey ? (JSON.parse(headerKey) as Record<string, string>) : {};
        const res = await fetch(`${base}/originals`, {
          cache: "no-store",
          signal: ctrl.signal,
          headers: { Accept: "application/json", ...extra },
        });
        if (!res.ok) return;
        const json = (await res.json().catch(() => null)) as CaseOriginalsResponse | null;
        if (!ctrl.signal.aborted && json?.side) setData(json);
      } catch {
        // The record as judged is still shown.
      }
    })();
    return () => ctrl.abort();
  }, [base, headerKey, enabled]);
  return enabled ? data : null;
}

/** "Your side as you wrote it" (and the added context), for this party only. */
export function CaseOriginals({ lang, data }: { lang: Lang; data: CaseOriginalsResponse | null }) {
  if (!data) return null;
  return (
    <div className={styles.stack}>
      <OriginalDisclosure lang={lang} title={t(lang, "case.originalTitle")} status={data.side.status} original={data.side.original} />
      {data.appeal ? (
        <OriginalDisclosure
          lang={lang}
          title={t(lang, "case.appealOriginal")}
          status={data.appeal.status}
          original={data.appeal.original}
        />
      ) : null}
    </div>
  );
}

/**
 * This party's name on the case's share pages, and (owner only) the switch
 * for names on the shared pages. PATCH <base>/display; the answer is the
 * fresh case view.
 */
export function CaseNames({
  lang,
  view,
  base,
  headers,
  body = {},
  onView,
}: {
  lang: Lang;
  view: CaseView;
  base: string;
  headers?: Record<string, string> | null;
  /** Extra body fields (the respondent's claim). */
  body?: Record<string, string>;
  onView: (view: CaseView) => void;
}) {
  const inputId = useId();
  const mine = view.yourParty === "a" ? view.display.a : view.display.b;
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (view.removed) return null;
  const value = name ?? mine ?? "";

  async function send(patch: { displayName?: string | null; namesVisible?: boolean }) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`${base}/display`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(headers ?? {}) },
        body: JSON.stringify({ ...body, ...patch }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const code = (json as { code?: unknown } | null)?.code;
        setError(code === "invalid" ? t(lang, "names.invalid") : apiErrorMessage(lang, json, res.status));
        return;
      }
      const next = (json as CaseResponse | null)?.case;
      if (next) onView(next);
      setName(null);
      setSaved(true);
    } catch {
      setError(t(lang, "names.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={`${account.card} ${styles.stack}`}
      onSubmit={(e) => {
        e.preventDefault();
        void send({ displayName: value.trim() ? value.trim() : null });
      }}
    >
      {view.role === "owner" ? (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={view.display.namesVisible}
            disabled={busy}
            onChange={(e) => void send({ namesVisible: e.target.checked })}
          />
          <span>{t(lang, "names.show")}</span>
        </label>
      ) : null}
      <div className={styles.field}>
        <label htmlFor={inputId} className={styles.fieldLabel}>
          {t(lang, "case.displayName")}
        </label>
        <div className={styles.row}>
          <input
            id={inputId}
            className={account.input}
            value={value}
            maxLength={40}
            autoComplete="given-name"
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className={`${account.btn} ${account.secondary}`} disabled={busy}>
            {t(lang, "case.displaySave")}
          </button>
        </div>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : saved ? (
        <p className={styles.note} role="status">
          {t(lang, "names.saved")}
        </p>
      ) : null}
    </form>
  );
}
