"use client";

import { useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import type { VerdictResult } from "@/lib/types";
import { LangToggle } from "./LangToggle";
import { VerdictView } from "./VerdictView";
import styles from "./verdict/verdict.module.css";

/** Share-page verdict whose language the viewer picks. Starts in the page's
 * Accept-Language; the choice stays on this page (it never writes the home
 * page's stored preference) and VerdictView brings the verdict text along. */
export function SharedVerdict({
  id,
  result,
  initialLang,
}: {
  id: string;
  result: VerdictResult;
  initialLang: Lang;
}) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const label = t(lang, "translate.toggle");
  return (
    <div lang={lang} className="flex flex-col gap-4 min-w-0">
      <div className={styles.langRow}>
        <span className={styles.langLabel} aria-hidden>
          {label}
        </span>
        <LangToggle lang={lang} onSelect={setLang} label={label} />
      </div>
      <VerdictView result={result} lang={lang} shareId={id} />
    </div>
  );
}
