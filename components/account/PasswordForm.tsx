"use client";

import { useId, useState } from "react";
import { passwordSaveErrorKey, savePassword } from "@/lib/auth-client";
import { t, type Lang } from "@/lib/i18n";
import styles from "./AccountPages.module.css";

const PASSWORD_MIN = 8;

/** Settings: change the password of an account that has one. The current
 * password is always asked for. */
export function PasswordForm({ lang }: { lang: Lang }) {
  const id = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (pending) return;
    setDone(false);
    if (next.length < PASSWORD_MIN) return setError(t(lang, "signin.passwordShort"));
    setPending(true);
    setError(null);
    const res = await savePassword(next, current, lang);
    setPending(false);
    if (res.ok) {
      setCurrent("");
      setNext("");
      setDone(true);
    } else {
      setError(t(lang, passwordSaveErrorKey(res.code)));
    }
  }

  return (
    <form
      className={styles.card}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2 className={styles.sectionTitle}>{t(lang, "settings.passwordChange")}</h2>
      <label className={styles.label} htmlFor={`${id}-current`}>
        {t(lang, "settings.passwordCurrent")}
      </label>
      <input
        id={`${id}-current`}
        className={styles.input}
        type="password"
        autoComplete="current-password"
        required
        maxLength={128}
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <label className={styles.label} htmlFor={`${id}-new`}>
        {t(lang, "signin.passwordNew")}
      </label>
      <input
        id={`${id}-new`}
        className={styles.input}
        type="password"
        autoComplete="new-password"
        required
        maxLength={128}
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className={styles.ok} role="status">
          {t(lang, "settings.passwordChanged")}
        </p>
      ) : null}
      <div className={styles.row}>
        <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={pending || !current || !next}>
          {t(lang, "settings.passwordChange")}
        </button>
      </div>
    </form>
  );
}
