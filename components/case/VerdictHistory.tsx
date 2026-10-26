"use client";

import { formatDate, t, type Lang } from "@/lib/i18n";
import type { NameMapping, VerdictResult } from "@/lib/types";
import { VerdictView } from "../VerdictView";
import styles from "./case.module.css";

/** Earlier verdicts (every one but the last of `verdicts`, which is
 * current), newest first, each collapsed. `linked`: their share links are
 * open (a removed case's verdicts stay readable here, unlinked). */
export function VerdictHistory({
  lang,
  verdicts,
  linked,
  names,
  selfParty,
  viewerIsSelfParty = true,
}: {
  lang: Lang;
  verdicts: readonly { id: string; result: VerdictResult; createdAt: string }[];
  linked: boolean;
  names: NameMapping[];
  selfParty: "A" | "B";
  viewerIsSelfParty?: boolean;
}) {
  const earlier = verdicts.slice(0, -1).reverse();
  if (earlier.length === 0) return null;
  return (
    <section className={styles.history} aria-labelledby="history-title">
      <h2 id="history-title" className={styles.h2}>
        {t(lang, "appeal.history")}
      </h2>
      {earlier.map((v) => (
        <details key={v.id} className={styles.previous}>
          <summary>
            <span>{t(lang, "appeal.previous")}</span>
            <span>{formatDate(lang, v.createdAt) ?? ""}</span>
          </summary>
          <div className={styles.previousBody}>
            <VerdictView
              result={v.result}
              nameMap={names}
              shareId={linked ? v.id : undefined}
              lang={lang}
              selfParty={selfParty}
              viewerIsSelfParty={viewerIsSelfParty}
            />
          </div>
        </details>
      ))}
    </section>
  );
}
