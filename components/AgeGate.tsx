"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { CONTACT_EMAIL } from "@/app/site";
import type { AgeState } from "@/lib/account-types";
import { t, type Lang } from "@/lib/i18n";
import { applyAge, markSignedOut, useViewer } from "@/lib/use-viewer";
import styles from "./account/AccountPages.module.css";

/** The sign-in page's tick, kept until the account it led to is seen. In
 * localStorage, not sessionStorage: an email sign-in link opens a new tab. */
const TICK_KEY = "judge.adultTicked";
const TICK_MS = 30 * 60_000;

export function rememberAdultTick(): void {
  try {
    localStorage.setItem(TICK_KEY, String(Date.now()));
  } catch {
    // Storage blocked: the dialog asks once more after sign-in.
  }
}

/** A sign-in that failed, or was given up on (back on the sign-in page),
 * must not confirm whoever signs in next in this browser. */
export function forgetAdultTick(): void {
  try {
    localStorage.removeItem(TICK_KEY);
  } catch {
    // nothing stored
  }
}

function takeAdultTick(): boolean {
  try {
    const at = Number(localStorage.getItem(TICK_KEY));
    localStorage.removeItem(TICK_KEY);
    return at > 0 && Date.now() - at < TICK_MS;
  } catch {
    return false;
  }
}

/** One confirmation at a time across the AgeGate of each page, so a page
 * change while the sign-in page's tick is being sent does not ask again. */
let sending: Promise<boolean> | null = null;

function sendConfirm(): Promise<boolean> {
  sending ??= (async () => {
    const { confirmAdult } = await import("@/lib/auth-client");
    const age = await confirmAdult();
    if (age) applyAge(age);
    return age !== null;
  })().finally(() => {
    sending = null;
  });
  return sending;
}

/** Pages a gated account can still open: its account (to delete it) and
 * the two legal pages. */
const OPEN_PAGES = new Set(["/account", "/privacy", "/terms"]);

/** The 18+ box, shared by the sign-in page and the dialog below. */
export function AdultCheck({ lang, checked, onChange }: { lang: Lang; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <label className={styles.check} htmlFor={id}>
      <input id={id} type="checkbox" required checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{t(lang, "age.confirm")}</span>
    </label>
  );
}

export type AgeDialogProps = {
  lang: Lang;
  age: AgeState;
  ticked: boolean;
  saving: boolean;
  failed: boolean;
  contactEmail: string | null;
  onTick: (v: boolean) => void;
  onConfirm: () => void;
  onSignOut: () => void;
};

/** The dialog's content, stateless so tests can render both states. */
export function AgeDialogBody({ lang, age, ticked, saving, failed, contactEmail, onTick, onConfirm, onSignOut }: AgeDialogProps) {
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
          <Link href="/account" className={styles.link}>
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
      <AdultCheck lang={lang} checked={ticked} onChange={onTick} />
      {failed ? (
        <p className={styles.error} role="alert">
          {t(lang, "age.failed")}
        </p>
      ) : null}
      <div className={styles.row}>
        <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={!ticked || saving} onClick={onConfirm}>
          {t(lang, "age.continue")}
        </button>
        {signOut}
      </div>
    </>
  );
}

/**
 * For signed-in accounts that have not confirmed they are 18 or older, or
 * that are blocked: a dialog that cannot be dismissed. A tick made on the
 * sign-in page is sent without asking again.
 */
export function AgeGate({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  const { me } = useViewer();
  const age = me?.user ? (me.age ?? null) : null;
  const unconfirmed = Boolean(age && !age.blocked && !age.confirmed);
  const [ask, setAsk] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  async function confirm() {
    setSaving(true);
    setFailed(false);
    const ok = await sendConfirm();
    setSaving(false);
    setFailed(!ok);
  }

  useEffect(() => {
    if (!unconfirmed) return;
    if (!sending && takeAdultTick()) void sendConfirm();
    if (!sending) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the tick lives in localStorage, read after mount
      setAsk(true);
      return;
    }
    let live = true;
    void sending.then((ok) => {
      if (live && !ok) {
        setFailed(true);
        setAsk(true);
      }
    });
    return () => {
      live = false;
    };
  }, [unconfirmed]);

  const open = Boolean(age) && (age!.blocked || (unconfirmed && ask)) && !OPEN_PAGES.has(pathname);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!age || (!age.blocked && !unconfirmed)) return null;

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
        ticked={ticked}
        saving={saving}
        failed={failed}
        contactEmail={CONTACT_EMAIL}
        onTick={setTicked}
        onConfirm={() => void confirm()}
        onSignOut={() => void signOut()}
      />
    </dialog>
  );
}
