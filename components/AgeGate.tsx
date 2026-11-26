"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CONTACT_EMAIL } from "@/app/site";
import type { AgeState } from "@/lib/account-types";
import { underThirteen } from "@/lib/age-date";
import { t, type Lang } from "@/lib/i18n";
import { langTag } from "@/lib/langs";
import { applyAge, currentAge, markSignedOut, refreshViewer, useViewer } from "@/lib/use-viewer";
import styles from "./account/AccountPages.module.css";

/** A stable ref callback: focus once, when the element appears. */
function focusEl(el: HTMLElement | null): void {
  el?.focus();
}

/** Pages a gated account can still open: its account (to delete it) and
 * the two legal pages. */
const OPEN_PAGES = new Set(["/account", "/settings", "/settings/account", "/privacy", "/terms"]);

export type AgeDialogProps = {
  lang: Lang;
  age: AgeState;
  dob: string;
  /** The latest date the field takes: today anywhere on Earth. */
  max: string;
  /** An under-13 date waits for a second look before it is sent. */
  confirming: boolean;
  saving: boolean;
  failed: boolean;
  contactEmail: string | null;
  onDob: (v: string) => void;
  onSubmit: () => void;
  onChange: () => void;
  onSignOut: () => void;
};

function longDate(lang: Lang, dob: string): string {
  const d = new Date(`${dob}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? dob : new Intl.DateTimeFormat(langTag(lang), { dateStyle: "long", timeZone: "UTC" }).format(d);
}

/** The dialog's content, stateless so tests can render both states. */
export function AgeDialogBody({ lang, age, dob, max, confirming, saving, failed, contactEmail, onDob, onSubmit, onChange, onSignOut }: AgeDialogProps) {
  const signOut = (
    <button type="button" className={`${styles.btn} ${styles.secondary}`} onClick={onSignOut}>
      {t(lang, "nav.signOut")}
    </button>
  );
  if (age.blocked && !age.needsDob) {
    const [before, after = ""] = t(lang, "age.blockedContact").split("{email}");
    return (
      <>
        <h2 id="age-title" className={styles.dialogTitle} tabIndex={-1} ref={focusEl}>
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
  if (confirming) {
    return (
      <>
        <h2 id="age-title" className={styles.dialogTitle}>
          {t(lang, "age.title")}
        </h2>
        <p className={styles.dialogText} tabIndex={-1} ref={focusEl}>
          {t(lang, "age.confirmDate", { date: longDate(lang, dob) })}
        </p>
        {failed ? (
          <p className={styles.error} role="alert">
            {t(lang, "age.failed")}
          </p>
        ) : null}
        <div className={styles.row}>
          <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={saving} onClick={onSubmit}>
            {t(lang, "age.confirmYes")}
          </button>
          <button type="button" className={`${styles.btn} ${styles.secondary}`} disabled={saving} onClick={onChange}>
            {t(lang, "age.change")}
          </button>
        </div>
      </>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (dob && !saving) onSubmit();
      }}
    >
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
          autoFocus
          min="1900-01-01"
          max={max}
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
        <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={!dob || saving}>
          {t(lang, "age.continue")}
        </button>
        {signOut}
      </div>
    </form>
  );
}

/**
 * For signed-in accounts that have not given a date of birth, or that are
 * blocked for good (under 13): a dialog that cannot be dismissed. A block
 * from the old 18+ rule shows the date step too. An under-13 date waits for a
 * second look; the answer to it turns the same dialog into the refusal.
 */
export function AgeGate({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  const { me } = useViewer();
  const age = me?.user ? (me.age ?? null) : null;
  const asking = Boolean(age && age.needsDob);
  const [dob, setDob] = useState("");
  const [max] = useState(() => new Date(Date.now() + 14 * 3_600_000).toISOString().slice(0, 10));
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  async function send() {
    setSaving(true);
    setFailed(false);
    try {
      const { submitDob } = await import("@/lib/auth-client");
      const res = await submitDob(dob);
      if ("age" in res) {
        applyAge(res.age);
      } else if (res.status === 409 || res.status === 403) {
        // Given elsewhere, or the account was closed there: show what the server holds.
        await refreshViewer();
        // Still asking: the refusal was not about the date (e.g. a blocked origin), or the refresh failed.
        if (currentAge()?.needsDob !== false) setFailed(true);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  function submit() {
    if (!confirming && underThirteen(dob)) {
      setConfirming(true);
      return;
    }
    void send();
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
        max={max}
        confirming={confirming}
        saving={saving}
        failed={failed}
        contactEmail={CONTACT_EMAIL}
        onDob={setDob}
        onSubmit={submit}
        onChange={() => {
          setConfirming(false);
          setFailed(false);
        }}
        onSignOut={() => void signOut()}
      />
    </dialog>
  );
}
