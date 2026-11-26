"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { browserOptedOut, setUsageStats, track, usageStatsOn } from "@/lib/analytics/client";
import { askSignIn, fetchConsent, saveConsent } from "@/lib/feedback-client";
import { t, type Key } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { setTheme, useDark } from "@/lib/theme";
import { signInOffered, useViewer } from "@/lib/use-viewer";
import { LangPicker } from "../LangPicker";
import { AccountSection, SignOutRow } from "./AccountView";
import { PasswordForm } from "./PasswordForm";
import styles from "./AccountPages.module.css";
import { PageShell } from "./PageShell";

const LINKS: { href: string; label: Key }[] = [
  { href: "/about", label: "footer.about" },
  { href: "/about#how", label: "how.title" },
  { href: "/privacy", label: "footer.privacy" },
  { href: "/terms", label: "footer.terms" },
];

const OUT = "M7 17 17 7M8 7h9v9";

/** /settings: the account, language, appearance, the legal links and sign
 * out, in the order of the apps' Settings tab. */
export function SettingsView() {
  const lang = useLang();
  const dark = useDark();

  const viewer = useViewer();
  const signedIn = Boolean(viewer.me?.user);
  const [training, setTraining] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void fetchConsent().then((s) => live && setTraining(s?.state === "on"));
    return () => {
      live = false;
      setTraining(false);
    };
  }, [signedIn]);
  function changeTraining(on: boolean) {
    if (!signedIn) return askSignIn();
    setTraining(on);
    void saveConsent(on ? "on" : "off", "switch", "consent.switchDetail", lang).then((s) => {
      if (s === null) setTraining(!on);
    });
  }
  const teen = viewer.me?.age?.teen === true;
  const [stats, setStats] = useState(true);
  const [browserOff, setBrowserOff] = useState(false);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- the switch lives in localStorage and navigator, read after mount */
    setStats(usageStatsOn());
    setBrowserOff(browserOptedOut());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  function changeStats(on: boolean) {
    setStats(on);
    setUsageStats(on);
  }
  const nothingToShow = viewer.status === "ready" && !viewer.me?.user && !signInOffered(viewer.config);

  return (
    <PageShell lang={lang} title={t(lang, "nav.settings")}>
      {nothingToShow ? null : (
        <div className={styles.group}>
          <p className={styles.groupTitle}>{t(lang, "account.title")}</p>
          <AccountSection />
          {viewer.me?.hasPassword ? <PasswordForm lang={lang} /> : null}
        </div>
      )}

      <div className={styles.group}>
        <p className={styles.groupTitle}>{t(lang, "footer.language")}</p>
        <section className={`${styles.card} ${styles.langCard}`}>
          <LangPicker lang={lang} />
        </section>
      </div>

      <div className={styles.group}>
        <p className={styles.groupTitle}>{t(lang, "settings.appearance")}</p>
        <section className={styles.card}>
          <label className={`${styles.option} ${styles.switchRow}`}>
            <span>{t(lang, "settings.darkMode")}</span>
            <input
              type="checkbox"
              role="switch"
              className={styles.switch}
              checked={dark}
              onChange={(e) => {
                setTheme(e.target.checked ? "dark" : "light");
                track("settings_changed", { key: "appearance" });
              }}
            />
          </label>
        </section>
      </div>

      <div className={styles.group}>
        <section className={styles.card}>
          {teen ? null : (
            <>
              <label className={`${styles.option} ${styles.switchRow}`}>
                <span>{t(lang, "consent.switchTitle")}</span>
                <input
                  type="checkbox"
                  role="switch"
                  className={styles.switch}
                  checked={training}
                  onChange={(e) => changeTraining(e.target.checked)}
                />
              </label>
              <p className={styles.detail}>{t(lang, "consent.switchDetail")}</p>
            </>
          )}
          <label className={`${styles.option} ${styles.switchRow}`}>
            <span>{t(lang, "settings.usageStats")}</span>
            <input
              type="checkbox"
              role="switch"
              className={styles.switch}
              checked={stats && !teen && !browserOff}
              disabled={teen || browserOff}
              onChange={(e) => changeStats(e.target.checked)}
            />
          </label>
          <p className={styles.detail}>
            {t(lang, teen ? "settings.usageStatsTeen" : browserOff ? "settings.usageStatsBrowser" : "settings.usageStatsHint")}
          </p>
        </section>
      </div>

      <nav aria-label={t(lang, "nav.settings")} className={styles.card}>
        <ul className={styles.options}>
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className={styles.option}>
                <span>{t(lang, l.label)}</span>
                <svg viewBox="0 0 24 24" aria-hidden className={styles.out}>
                  <path
                    d={OUT}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <SignOutRow />

      <p className={styles.footNote}>{t(lang, "footer.note")}</p>
    </PageShell>
  );
}
