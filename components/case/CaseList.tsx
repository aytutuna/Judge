"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CaseListResponse, CaseSummary } from "@/lib/case-types";
import { formatDate, t, tWithDate, type Lang } from "@/lib/i18n";
import { localizeLabelsAuto } from "@/lib/names";
import account from "../account/AccountPages.module.css";
import { StatusChip } from "./CaseScreen";
import styles from "./case.module.css";

export type CaseListState =
  | { status: "loading" }
  | { status: "ready"; cases: CaseSummary[] }
  | { status: "error" };

/** "Your cases" on the account page: newest first, each a link to its case
 * page. Titles are the anonymized verdict headline, else the first words of
 * your anonymized side, so open cases can be told apart. Removed cases are
 * marked as such. Stateless for tests. */
export function CaseList({ lang, state }: { lang: Lang; state: CaseListState }) {
  return (
    <section className={account.card} aria-labelledby="cases-title">
      <h2 id="cases-title" className={account.sectionTitle}>
        {t(lang, "case.list.title")}
      </h2>
      {state.status === "loading" ? (
        <p className={account.muted} role="status">
          {t(lang, "case.loading")}
        </p>
      ) : state.status === "error" ? (
        <p className={account.error} role="alert">
          {t(lang, "case.list.loadFailed")}
        </p>
      ) : state.cases.length === 0 ? (
        <p className={account.muted}>{t(lang, "case.list.empty")}</p>
      ) : (
        <ul className={styles.caseList}>
          {state.cases.map((c) => {
            const date = formatDate(lang, c.createdAt);
            return (
              <li key={c.id}>
                <Link href={`/c/${encodeURIComponent(c.id)}`} className={styles.caseLink}>
                  <span className={styles.caseHeadline}>
                    {c.headline ?? (c.excerpt ? localizeLabelsAuto(c.excerpt) : null) ?? tWithDate(lang, "case.list.untitled", c.createdAt)}
                  </span>
                  <span className={styles.caseMeta}>{date ? t(lang, "case.list.started", { date }) : null}</span>
                  {c.removed ? (
                    <span className={styles.status}>{t(lang, "account.verdicts.removed")}</span>
                  ) : (
                    <StatusChip lang={lang} status={c.status} />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Loads GET /api/v1/cases once for a signed-in viewer. */
export function useCaseList(enabled: boolean): CaseListState {
  const [state, setState] = useState<CaseListState>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/v1/cases?limit=20", { cache: "no-store", signal: ctrl.signal });
        const json = (await res.json().catch(() => null)) as CaseListResponse | null;
        if (ctrl.signal.aborted) return;
        setState(res.ok && json && Array.isArray(json.cases) ? { status: "ready", cases: json.cases } : { status: "error" });
      } catch {
        if (!ctrl.signal.aborted) setState({ status: "error" });
      }
    })();
    return () => ctrl.abort();
  }, [enabled]);
  return state;
}
