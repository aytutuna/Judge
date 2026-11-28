"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { ParentView } from "@/lib/account-types";
import { apiErrorMessage, t, type Lang } from "@/lib/i18n";
import { refreshViewer } from "@/lib/use-viewer";
import styles from "./account/AccountPages.module.css";
import { Turnstile, TURNSTILE_SITE_KEY } from "./Turnstile";

export type ParentStepProps = {
  lang: Lang;
  status: "pending" | "declined" | "revoked";
  view: ParentView | null;
  /** Typing a new address on top of one that was sent. */
  editing: boolean;
  email: string;
  busy: boolean;
  error: string | null;
  /** The bot check, shown with the buttons that send mail. */
  turnstile?: ReactNode;
  canSend: boolean;
  onEmail: (v: string) => void;
  onSend: () => void;
  onResend: () => void;
  onEdit: (on: boolean) => void;
  onSignOut: () => void;
};

/** What a teen who has to ask a parent sees, stateless so tests can render
 * every state. */
export function ParentStepBody({
  lang,
  status,
  view,
  editing,
  email,
  busy,
  error,
  turnstile,
  canSend,
  onEmail,
  onSend,
  onResend,
  onEdit,
  onSignOut,
}: ParentStepProps) {
  const leave = (
    <div className={styles.row}>
      <button type="button" className={`${styles.btn} ${styles.secondary}`} onClick={onSignOut}>
        {t(lang, "nav.signOut")}
      </button>
      <Link href="/settings/account" className={styles.link}>
        {t(lang, "account.delete")}
      </Link>
    </div>
  );
  const problem = error ? (
    <p className={styles.error} role="alert">
      {error}
    </p>
  ) : null;

  if (status === "declined") {
    return (
      <>
        <h2 id="age-title" className={styles.dialogTitle}>
          {t(lang, "age.parentDeclinedTitle")}
        </h2>
        <p className={styles.dialogText}>{t(lang, "age.parentDeclined")}</p>
        {leave}
      </>
    );
  }

  const sent = status === "pending" && Boolean(view?.sent) && !editing;
  if (sent && view) {
    return (
      <>
        <h2 id="age-title" className={styles.dialogTitle}>
          {t(lang, "age.parentWaitTitle")}
        </h2>
        <p className={styles.dialogText}>{t(lang, "age.parentSentTo", { email: view.emailHint ?? "" })}</p>
        {view.expired ? <p className={styles.dialogText}>{t(lang, "age.parentExpired")}</p> : null}
        <p className={styles.dialogText}>{t(lang, "age.parentDelete")}</p>
        {problem}
        {turnstile}
        <div className={styles.row}>
          <button
            type="button"
            className={`${styles.btn} ${styles.primary}`}
            disabled={busy || !canSend || view.resendsLeft === 0}
            onClick={onResend}
          >
            {t(lang, "age.parentResend")}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.secondary}`}
            disabled={busy || view.changesLeft === 0}
            onClick={() => onEdit(true)}
          >
            {t(lang, "age.parentChange")}
          </button>
        </div>
        {leave}
      </>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (email && !busy && canSend) onSend();
      }}
    >
      <h2 id="age-title" className={styles.dialogTitle}>
        {t(lang, status === "revoked" ? "age.parentRevokedTitle" : "age.parentTitle")}
      </h2>
      <p className={styles.dialogText}>{t(lang, status === "revoked" ? "age.parentRevoked" : "age.parentLead")}</p>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="parent-email">
          {t(lang, "age.parentEmail")}
        </label>
        <input
          id="parent-email"
          type="email"
          className={styles.input}
          required
          autoFocus
          autoComplete="off"
          maxLength={254}
          value={email}
          onChange={(e) => onEmail(e.target.value)}
        />
      </div>
      <p className={styles.dialogText}>{t(lang, "age.parentDelete")}</p>
      {problem}
      {turnstile}
      <div className={styles.row}>
        <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={!email || busy || !canSend}>
          {t(lang, "age.parentSend")}
        </button>
        {editing ? (
          <button type="button" className={`${styles.btn} ${styles.secondary}`} disabled={busy} onClick={() => onEdit(false)}>
            {t(lang, "age.parentCancel")}
          </button>
        ) : null}
      </div>
      {leave}
    </form>
  );
}

/** The parent step inside the age dialog: loads where the request stands and
 * sends, resends or changes the parent's address. */
export function ParentStep({ lang, status, onSignOut }: { lang: Lang; status: "pending" | "declined" | "revoked"; onSignOut: () => void }) {
  const [view, setView] = useState<ParentView | null>(null);
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [checkKey, setCheckKey] = useState(0);
  const needsCheck = TURNSTILE_SITE_KEY !== "";

  useEffect(() => {
    let live = true;
    void import("@/lib/auth-client").then(async ({ fetchParent }) => {
      const res = await fetchParent();
      if (live && res.ok) setView(res.view);
    });
    return () => {
      live = false;
    };
  }, []);

  // The parent answers on another device: look again every half minute and when the tab comes back.
  useEffect(() => {
    const look = () => {
      if (document.visibilityState !== "hidden") void refreshViewer();
    };
    const timer = setInterval(look, 30_000);
    document.addEventListener("visibilitychange", look);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", look);
    };
  }, []);

  async function run(call: (check: string | undefined) => ReturnType<typeof import("@/lib/auth-client").fetchParent>) {
    // A bot check token works once: take it now, the widget shows a new one.
    const check = token ?? undefined;
    setToken(null);
    setBusy(true);
    setError(null);
    try {
      const res = await call(check);
      if (res.ok) {
        setView(res.view);
        setEditing(false);
        setEmail("");
        // A revoked account that asked again is waiting again.
        await refreshViewer();
      } else {
        setError(apiErrorMessage(lang, res.body, res.status));
      }
    } finally {
      setBusy(false);
      setCheckKey((k) => k + 1);
    }
  }

  const send = () => void run(async (check) => (await import("@/lib/auth-client")).sendParent(email.trim(), check));
  const resend = () => void run(async (check) => (await import("@/lib/auth-client")).resendParent(check));

  return (
    <ParentStepBody
      lang={lang}
      status={status}
      view={view}
      editing={editing}
      email={email}
      busy={busy}
      error={error}
      canSend={!needsCheck || token !== null}
      turnstile={needsCheck ? <Turnstile key={checkKey} siteKey={TURNSTILE_SITE_KEY} lang={lang} onToken={setToken} /> : undefined}
      onEmail={setEmail}
      onSend={send}
      onResend={resend}
      onEdit={setEditing}
      onSignOut={onSignOut}
    />
  );
}
