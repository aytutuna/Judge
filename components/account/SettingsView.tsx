"use client";

import Link from "next/link";
import { track } from "@/lib/analytics/client";
import { t, type Key } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { setGame, useGame } from "@/lib/game";
import { setTheme, useTheme, type Theme } from "@/lib/theme";
import { signInOffered, useViewer } from "@/lib/use-viewer";
import { LangPicker } from "../LangPicker";
import { AccountSection, SignOutRow } from "./AccountView";
import styles from "./AccountPages.module.css";
import { PageShell } from "./PageShell";

const THEMES: { value: Theme; label: Key }[] = [
  { value: "system", label: "settings.appearanceSystem" },
  { value: "light", label: "settings.appearanceLight" },
  { value: "dark", label: "settings.appearanceDark" },
];

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
  const theme = useTheme();
  const game = useGame();

  const viewer = useViewer();
  const nothingToShow = viewer.status === "ready" && !viewer.me?.user && !signInOffered(viewer.config);

  return (
    <PageShell lang={lang} title={t(lang, "nav.settings")}>
      {nothingToShow ? null : (
        <div className={styles.group}>
          <p className={styles.groupTitle}>{t(lang, "account.title")}</p>
          <AccountSection />
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
          <div
            role="radiogroup"
            aria-label={t(lang, "settings.appearance")}
            className={styles.options}
          >
            {THEMES.map((o) => (
              <label key={o.value} className={styles.option}>
                <input
                  type="radio"
                  name="theme"
                  value={o.value}
                  checked={theme === o.value}
                  onChange={() => {
                    setTheme(o.value);
                    track("settings_changed", { key: "appearance" });
                  }}
                />
                <span>{t(lang, o.label)}</span>
                <svg viewBox="0 0 24 24" aria-hidden className={styles.optionTick}>
                  <path
                    d="m5 12.5 4.5 4.5L19 7.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </label>
            ))}
          </div>
          <div className={styles.options}>
            <label className={styles.option}>
              <input
                type="checkbox"
                checked={game}
                onChange={(e) => {
                  setGame(e.target.checked);
                  track("settings_changed", { key: "gamify" });
                }}
              />
              <span>{t(lang, "shell.gamify")}</span>
              <svg viewBox="0 0 24 24" aria-hidden className={styles.optionTick}>
                <path
                  d="m5 12.5 4.5 4.5L19 7.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </label>
          </div>
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
