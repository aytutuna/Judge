"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDate, t, type Lang } from "@/lib/i18n";
import { resolveParties, restoreNames, textLang } from "@/lib/names";
import type { OwnerVerdictListResponse, OwnerVerdictSummary } from "@/lib/originals-types";
import caseStyles from "../case/case.module.css";
import styles from "./AccountPages.module.css";

export type VerdictListState =
  | { status: "loading" }
  | { status: "ready"; verdicts: OwnerVerdictSummary[] }
  | { status: "error" };

/** The headline with the writer's own names put back (same conservative
 * rules as the verdict card). */
export function restoredHeadline(v: Pick<OwnerVerdictSummary, "headline" | "nameMap">): string | null {
  if (!v.headline) return null;
  const lang = textLang(v.headline);
  return restoreNames(v.headline, resolveParties(v.nameMap, lang, "A"), lang);
}

/** "Your verdicts" on the account page: newest first, each a link to its
 * share page (where the writer sees their own view). Removed ones are
 * listed, greyed, without a link. Stateless for tests. */
export function VerdictList({ lang, state }: { lang: Lang; state: VerdictListState }) {
  return (
    <section className={styles.card} aria-labelledby="verdicts-title">
      <h2 id="verdicts-title" className={styles.sectionTitle}>
        {t(lang, "account.verdicts.title")}
      </h2>
      {state.status === "loading" ? (
        <p className={styles.muted} role="status">
          {t(lang, "account.loading")}
        </p>
      ) : state.status === "error" ? (
        <p className={styles.error} role="alert">
          {t(lang, "account.verdicts.loadFailed")}
        </p>
      ) : state.verdicts.length === 0 ? (
        <p className={styles.muted}>{t(lang, "account.verdicts.empty")}</p>
      ) : (
        <ul className={caseStyles.caseList}>
          {state.verdicts.map((v) => {
            const date = formatDate(lang, v.createdAt) ?? "";
            if (v.removed) {
              return (
                <li key={v.id} className={caseStyles.caseLink} style={{ opacity: 0.6 }}>
                  <span className={caseStyles.caseHeadline}>{t(lang, "account.verdicts.removed")}</span>
                  <span className={caseStyles.caseMeta}>{date}</span>
                </li>
              );
            }
            return (
              <li key={v.id}>
                <Link href={`/v/${encodeURIComponent(v.id)}`} className={caseStyles.caseLink}>
                  <span className={caseStyles.caseHeadline}>{restoredHeadline(v) ?? date}</span>
                  <span className={caseStyles.caseMeta}>{date}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Loads GET /api/v1/me/verdicts once for a signed-in viewer. */
export function useVerdictList(enabled: boolean): VerdictListState {
  const [state, setState] = useState<VerdictListState>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/v1/me/verdicts?limit=20", { cache: "no-store", signal: ctrl.signal });
        const json = (await res.json().catch(() => null)) as OwnerVerdictListResponse | null;
        if (ctrl.signal.aborted) return;
        setState(res.ok && json && Array.isArray(json.verdicts) ? { status: "ready", verdicts: json.verdicts } : { status: "error" });
      } catch {
        if (!ctrl.signal.aborted) setState({ status: "error" });
      }
    })();
    return () => ctrl.abort();
  }, [enabled]);
  return state;
}
