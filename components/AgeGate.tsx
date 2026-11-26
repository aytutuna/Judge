"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CONTACT_EMAIL } from "@/app/site";
import type { AgeState } from "@/lib/account-types";
import { t, type Lang } from "@/lib/i18n";
import { applyAge, markSignedOut, useViewer } from "@/lib/use-viewer";
import styles from "./account/AccountPages.module.css";

/** Pages a gated account can still open: its account (to delete it) and
 * the two legal pages. */
const OPEN_PAGES = new Set(["/account", "/settings", "/settings/account", "/privacy", "/terms"]);

export type AgeDialogProps = {
  lang: Lang;
  age: AgeState;
  dob: string;
  saving: boolean;
  failed: boolean;
  contactEmail: string | null;
  onDob: (v: string) => void;
  onConfirm: () => void;
  onSignOut: () => void;
};

/** The dialog's content, stateless so tests can render both states. */
export function AgeDialogBody({ lang, age, dob, saving, failed, contactEmail, onDob, onConfirm, onSignOut }: AgeDialogProps) {
  const signOut = (
    <button type="button" className={`${styles.btn} ${styles.secondary}`} onClick={onSignOut}>
      {t(lang, "nav.signOut")}
    </button>
  );
  if (age.blocked) {
    const [before, after = ""] = t(lang, "age.blockedContact").split("{email}");
    return (
      <>
        <h2 id="age-title" className={styles.dialogTitle}>
          {t(lang, "age.blockedTitle")}
        </h2>
        <p className={styles.dialogText}>{t(lang, "age.blocked")}</p>
        {contactEmail ? (
          <p className={styles.dialogText}>
            {before}
            <a href={`mailto:${contactEmail}`} className={styles.link}>
              {contactEmail}
            </a>
            {after}
          </p>
        ) : null}
        <div className={styles.row}>
          {signOut}
          <Link href="/settings/account" className={styles.link}>
            {t(lang, "account.delete")}
          </Link>
        </div>
      </>
    );
  }
  return (
    <>
      <h2 id="age-title" className={styles.dialogTitle}>
        {t(lang, "age.title")}
      </h2>
      <p className={styles.dialogText}>{t(lang, "age.lead")}</p>
      <div className={styles.field}>
        <input
          type="date"
          className={styles.input}
          aria-labelledby="age-title"
          required
          min="1900-01-01"
          max={new Date().toISOString().slice(0, 10)}
          value={dob}
          onChange={(e) => onDob(e.target.value)}
        />
      </div>
      {failed ? (
        <p className={styles.error} role="alert">
          {t(lang, "age.failed")}
        </p>
      ) : null}
      <div className={styles.row}>
        <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={!dob || saving} onClick={onConfirm}>
          {t(lang, "age.continue")}
        </button>
        {signOut}
      </div>
    </>
  );
}

/**
 * For signed-in accounts that have not given a date of birth, or that are
 * blocked (under 13): a dialog that cannot be dismissed. An under-13 date is
 * answered with a blocked state, which turns the same dialog into the refusal.
 */
export function AgeGate({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  const { me } = useViewer();
  const age = me?.user ? (me.age ?? null) : null;
  const asking = Boolean(age && !age.blocked && age.needsDob);
  const [dob, setDob] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  async function confirm() {
    setSaving(true);
    setFailed(false);
    const { submitDob } = await import("@/lib/auth-client");
    const next = await submitDob(dob);
    if (next) applyAge(next);
    setSaving(false);
    setFailed(next === null);
  }

  const open = Boolean(age) && (age!.blocked || asking) && !OPEN_PAGES.has(pathname);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!age || (!age.blocked && !asking)) return null;

  async function signOut() {
    try {
      const { signOut: run } = await import("@/lib/auth-client");
      await run();
    } finally {
      markSignedOut();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="age-title"
      onCancel={(e) => e.preventDefault()}
      onClose={() => {
        if (open) dialogRef.current?.showModal();
      }}
    >
      <AgeDialogBody
        lang={lang}
        age={age}
        dob={dob}
        saving={saving}
        failed={failed}
        contactEmail={CONTACT_EMAIL}
        onDob={setDob}
        onConfirm={() => void confirm()}
        onSignOut={() => void signOut()}
      />
    </dialog>
  );
}
