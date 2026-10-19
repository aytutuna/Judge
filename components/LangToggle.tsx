"use client";

import { t, type Lang } from "@/lib/i18n";
import { setLang } from "@/lib/lang";
import styles from "./LangToggle.module.css";

/** TR | EN switch. Writes the client language store, so it only belongs on
 * pages whose chrome reads that store (not the Accept-Language share page)
 * — unless `onSelect` is given, which replaces the store write and lets a
 * caller keep the choice local. `label` overrides the group's aria label. */
export function LangToggle({
  lang,
  onSelect = setLang,
  label,
}: {
  lang: Lang;
  onSelect?: (l: Lang) => void;
  label?: string;
}) {
  // Each button's label is written in its target language, so it carries
  // that lang for screen readers whatever the page language is.
  const side = (l: Lang, text: string, aria: string) => (
    <button
      type="button"
      lang={l}
      aria-pressed={lang === l}
      aria-label={aria}
      onClick={() => onSelect(l)}
      className={styles.option}
    >
      {text}
    </button>
  );
  return (
    <div className={styles.seg} role="group" aria-label={label ?? t(lang, "footer.language")}>
      {side("tr", "TR", t(lang, "langToggle.toTr"))}
      {side("en", "EN", t(lang, "langToggle.toEn"))}
    </div>
  );
}
