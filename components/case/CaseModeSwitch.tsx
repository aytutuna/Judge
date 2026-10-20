"use client";

import { useId } from "react";
import { t, type Lang } from "@/lib/i18n";
import styles from "./case.module.css";

/** "now": a one-sided premium verdict right away (today's flow). "both": a
 * two-sided case with an invite link. */
export type CaseMode = "now" | "both";

/**
 * Premium's mode choice in the hero card. Native radios in a fieldset, so
 * arrow keys and screen readers work as usual; the hint below says what the
 * chosen mode does and is tied to the group with aria-describedby.
 */
export function CaseModeSwitch({
  lang,
  value,
  onChange,
  disabled = false,
}: {
  lang: Lang;
  value: CaseMode;
  onChange: (mode: CaseMode) => void;
  disabled?: boolean;
}) {
  const name = useId();
  const hintId = useId();
  const options: { mode: CaseMode; label: string }[] = [
    { mode: "now", label: t(lang, "mode.now") },
    { mode: "both", label: t(lang, "mode.both") },
  ];
  return (
    <fieldset className={styles.mode} aria-describedby={hintId} disabled={disabled}>
      <legend className={styles.modeLegend}>{t(lang, "mode.label")}</legend>
      <div className={styles.modeOptions}>
        {options.map((o) => (
          <label key={o.mode} className={styles.modeOption}>
            <input
              type="radio"
              name={name}
              value={o.mode}
              checked={value === o.mode}
              onChange={() => onChange(o.mode)}
              className={styles.modeInput}
            />
            <span className={styles.modeFace}>
              <span className={styles.modeRadio} aria-hidden />
              {o.label}
            </span>
          </label>
        ))}
      </div>
      <p id={hintId} className={styles.modeHint}>
        {t(lang, value === "both" ? "mode.bothHint" : "mode.nowHint")}
      </p>
    </fieldset>
  );
}
