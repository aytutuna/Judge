"use client";

import { useId, useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import { refreshViewer } from "@/lib/use-viewer";
import styles from "./AccountPages.module.css";

const MIN = 8;

/** Settings: set a password, or change the one the account has. Changing asks
 * for the current one; other devices are signed out when it succeeds. */
export function PasswordRow({ lang, email, hasPassword }: { lang: Lang; email: string; hasPassword: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  function close() {
    setOpen(false);
    setCurrent("");
    setNext("");
    setShow(false);
    setError(null);
  }

  async function save() {
    if (next.length < MIN) {
      setError(t(lang, "signin.passwordShort"));
      return;
    }
    setPending(true);
    setError(null);
    const { savePassword, passwordSaveErrorKey } = await import("@/lib/auth-client");
    const res = await savePassword(next, hasPassword ? current : undefined);
    setPending(false);
    if (!res.ok) {
      setError(t(lang, passwordSaveErrorKey(res.code)));
      return;
    }
    close();
    setSaved(true);
    void refreshViewer();
  }

  const type = show ? "text" : "password";
  return (
    <section className={styles.card}>
      {saved ? (
        <p className={styles.ok} role="status">
          {t(lang, "account.passwordSaved")}
        </p>
      ) : null}
      {open ? (
        <form
          className={styles.field}
          onSubmit={(e) => {
            e.preventDefault();
            if (!pending) void save();
          }}
        >
          <input type="email" autoComplete="username" className="sr-only" tabIndex={-1} aria-hidden readOnly value={email} />
          {hasPassword ? (
            <>
              <label className={styles.label} htmlFor={`${id}-current`}>
                {t(lang, "account.passwordCurrent")}
              </label>
              <input
                id={`${id}-current`}
                className={styles.input}
                type={type}
                autoComplete="current-password"
                required
                maxLength={128}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </>
          ) : null}
          <label className={styles.label} htmlFor={`${id}-new`}>
            {t(lang, "signin.passwordNew")}
          </label>
          <input
            id={`${id}-new`}
            className={styles.input}
            type={type}
            autoComplete="new-password"
            required
            maxLength={128}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <button type="button" className={styles.textBtn} aria-pressed={show} onClick={() => setShow((v) => !v)}>
            {t(lang, "signin.passwordShow")}
          </button>
          {error ? (
            <p id={`${id}-error`} className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <div className={styles.row}>
            <button
              type="submit"
              className={`${styles.btn} ${styles.primary}`}
              disabled={pending || next === "" || (hasPassword && current === "")}
            >
              {t(lang, "signin.passwordSave")}
            </button>
            <button type="button" className={`${styles.btn} ${styles.secondary}`} disabled={pending} onClick={close}>
              {t(lang, "case.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className={`${styles.btn} ${styles.secondary}`}
          onClick={() => {
            setSaved(false);
            setOpen(true);
          }}
        >
          {t(lang, hasPassword ? "account.passwordChange" : "account.passwordSet")}
        </button>
      )}
    </section>
  );
}
