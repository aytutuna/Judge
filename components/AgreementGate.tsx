"use client";

import { useEffect, useId, useRef, useState } from "react";
import { setAgreementAsker } from "@/lib/api-fetch";
import { askSignIn, saveAgreement } from "@/lib/feedback-client";
import { t, type Lang } from "@/lib/i18n";
import styles from "./account/AccountPages.module.css";

/** The one-time private-details tick, asked when the server refuses a
 * verdict or a case side with agreement_required. Escape closes it and the
 * request keeps the server's error. */
export function AgreementGate({ lang }: { lang: Lang }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const waiting = useRef<((agreed: boolean) => void) | null>(null);
  const id = useId();
  const [ticked, setTicked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setAgreementAsker(
      () =>
        new Promise<boolean>((resolve) => {
          waiting.current?.(false);
          waiting.current = resolve;
          setTicked(false);
          setFailed(false);
          dialogRef.current?.showModal();
        }),
    );
    return () => setAgreementAsker(null);
  }, []);

  function finish(agreed: boolean) {
    const resolve = waiting.current;
    waiting.current = null;
    if (dialogRef.current?.open) dialogRef.current.close();
    resolve?.(agreed);
  }

  async function confirm() {
    setSaving(true);
    setFailed(false);
    const result = await saveAgreement(lang);
    setSaving(false);
    if (result === "ok") finish(true);
    else if (result === "signin") askSignIn();
    else setFailed(true);
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={`${id}-title`} onClose={() => finish(false)}>
      <h2 id={`${id}-title`} className={styles.dialogTitle}>
        {t(lang, "consent.sensitiveTitle")}
      </h2>
      <label className={styles.check}>
        <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
        <span>{t(lang, "consent.sensitiveBody")}</span>
      </label>
      {failed ? (
        <p className={styles.error} role="alert">
          {t(lang, "age.failed")}
        </p>
      ) : null}
      <div className={styles.row}>
        <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={!ticked || saving} onClick={() => void confirm()}>
          {t(lang, "consent.sensitiveContinue")}
        </button>
      </div>
    </dialog>
  );
}
