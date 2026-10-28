"use client";

import { t, type Lang } from "@/lib/i18n";
import { setLang } from "@/lib/lang";
import { ENABLED, LANGS } from "@/lib/langs";
import styles from "./LangPicker.module.css";

/** Interface language picker, each language under its own name. Writes the
 * client language store, so it only belongs on pages whose chrome reads that
 * store (not the Accept-Language share page) — unless `onSelect` is given,
 * which replaces the store write and lets a caller keep the choice local.
 * `label` overrides the aria label. */
export function LangPicker({
  lang,
  onSelect = setLang,
  label,
}: {
  lang: Lang;
  onSelect?: (l: Lang) => void;
  label?: string;
}) {
  return (
    <span className={styles.wrap}>
      <select
        value={lang}
        aria-label={label ?? t(lang, "footer.language")}
        onChange={(e) => onSelect(e.target.value as Lang)}
        className={styles.select}
      >
        {ENABLED.map((l) => (
          // Each name is written in its own language, whatever the page's.
          <option key={l} value={l} lang={l}>
            {LANGS[l].native}
          </option>
        ))}
      </select>
    </span>
  );
}
