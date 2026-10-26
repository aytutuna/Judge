"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { saveDraftForSignIn } from "@/lib/draft";
import { t, type Lang } from "@/lib/i18n";
import styles from "./case.module.css";

/** "now": a verdict right away (today's flow). "both": a two-sided case
 * with an invite link. */
export type CaseMode = "now" | "both";

/**
 * The mode choice in the hero card. Native radios in a fieldset, so arrow
 * keys and screen readers work as usual; the hint below says what the
 * chosen mode does and is tied to the group with aria-describedby.
 * `locked` (signed out): picking "both" keeps "now" and puts a sign-in link
 * in the hint instead, the way the tier switch locks Premium.
 */
export function CaseModeSwitch({
  lang,
  value,
  onChange,
  disabled = false,
  locked = false,
}: {
  lang: Lang;
  value: CaseMode;
  onChange: (mode: CaseMode) => void;
  disabled?: boolean;
  locked?: boolean;
}) {
  const name = useId();
  const hintId = useId();
  const [nudged, setNudged] = useState(false);
  const options: { mode: CaseMode; label: string }[] = [
    { mode: "now", label: t(lang, "mode.now") },
    { mode: "both", label: t(lang, "mode.both") },
  ];

  function pick(mode: CaseMode) {
    if (mode === "both" && locked) {
      setNudged(true);
      return;
    }
    onChange(mode);
  }

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
              onChange={() => pick(o.mode)}
              onClick={() => {
                if (o.mode === "both" && locked) setNudged(true);
              }}
              className={styles.modeInput}
            />
            <span className={styles.modeFace}>
              <span className={styles.modeRadio} aria-hidden />
              {o.label}
              {o.mode === "both" && locked ? (
                <span className="sr-only"> {t(lang, "tier.lockedSignIn")}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
      <p id={hintId} className={styles.modeHint} aria-live="polite">
        {locked && nudged ? (
          <>
            {t(lang, "mode.bothHint")}{" "}
            <Link href="/signin?next=%2F" className={styles.modeLink} onClick={saveDraftForSignIn}>
              {t(lang, "mode.signIn")}
            </Link>
          </>
        ) : (
          t(lang, value === "both" ? "mode.bothHint" : "mode.nowHint")
        )}
      </p>
    </fieldset>
  );
}
