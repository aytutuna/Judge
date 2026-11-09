"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { AccountPicture, returnPath, signOutNow } from "@/components/AccountMenu";
import { saveDraftForSignIn } from "@/lib/draft";
import { t, type Key, type Lang } from "@/lib/i18n";
import { useViewer } from "@/lib/use-viewer";
import { stateLabel, titleOf, tone } from "./HistoryList";
import { useHistory } from "./useHistory";
import styles from "./shell.module.css";

const RECENT = 5;

type Props = {
  lang: Lang;
  pathname: string | null;
  onHome?: () => void;
};

/** The phone's menu, as in the native app: a button in the header that opens
 * a panel with New, a Verdicts heading over the newest few verdicts, and at
 * the bottom the profile (Pricing, Sign in or Sign out) above Settings. `onHome` resets the home page instead of navigating to
 * itself. Hidden from 960px, where the header carries the same links. */
export function SideMenu(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={styles.menuButton}
        aria-label={t(props.lang, "nav.tabs")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
        </svg>
      </button>
      {open ? (
        <Panel {...props} onClosed={() => setOpen(false)} />
      ) : null}
    </>
  );
}

export function Panel({ lang, pathname, onHome, onClosed }: Props & { onClosed: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewer = useViewer();
  const history = useHistory(viewer);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const root = document.documentElement;
    root.style.overflow = "hidden";
    const wide = matchMedia("(min-width: 960px)");
    const onWide = () => dialog.close();
    wide.addEventListener("change", onWide);
    return () => {
      root.style.overflow = "";
      wide.removeEventListener("change", onWide);
    };
  }, []);

  const close = () => dialogRef.current?.close();
  const recent = history.status === "loading" ? [] : history.items.slice(0, RECENT);
  const user = viewer.me?.user ?? null;
  const [profileOpen, setProfileOpen] = useState(false);
  const profileId = useId();

  function row(href: string, label: Key, onClick?: (e: MouseEvent) => void) {
    return (
      <Link
        href={href}
        className={styles.menuRow}
        aria-current={pathname === href ? "page" : undefined}
        onClick={(e) => {
          onClick?.(e);
          close();
        }}
      >
        {t(lang, label)}
      </Link>
    );
  }

  return (
    <dialog ref={dialogRef} className={styles.menu} aria-label={t(lang, "nav.tabs")} onClose={onClosed}>
      <nav className={styles.panel} aria-label={t(lang, "nav.tabs")}>
        <ul>
          <li>
            {row("/", "nav.new", (e) => {
              if (!onHome) return;
              e.preventDefault();
              onHome();
            })}
          </li>
          <li>
            <Link
              href="/verdicts"
              className={styles.menuHeading}
              aria-current={pathname === "/verdicts" ? "page" : undefined}
              onClick={close}
            >
              {t(lang, "nav.verdicts")}
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </li>
          {recent.map((item) => {
            const state = item.kind === "verdict" && item.state === "removed" ? null : stateLabel(lang, item);
            const inner = (
              <>
                <span className={styles.recentTitle}>{titleOf(lang, item)}</span>
                {state ? <span className={styles.recentState}>{state}</span> : null}
              </>
            );
            return (
              <li key={`${item.kind}-${item.id}`}>
                {item.href ? (
                  <Link href={item.href} className={styles.recent} data-tone={tone(item)} onClick={close}>
                    {inner}
                  </Link>
                ) : (
                  <span className={styles.recent} data-removed="">
                    {inner}
                  </span>
                )}
              </li>
            );
          })}
          <li className={styles.menuEnd}>
            <div id={profileId} className={styles.profileItems} hidden={!profileOpen}>
              <Link href="/pricing" className={styles.menuRow} onClick={close}>
                {t(lang, "nav.pricing")}
              </Link>
              {user ? (
                <button
                  type="button"
                  className={styles.menuRow}
                  onClick={() => {
                    close();
                    void signOutNow();
                  }}
                >
                  {t(lang, "nav.signOut")}
                </button>
              ) : (
                <Link
                  href={`/signin?next=${encodeURIComponent(returnPath(pathname))}`}
                  className={styles.menuRow}
                  onClick={() => {
                    saveDraftForSignIn();
                    close();
                  }}
                >
                  {t(lang, "nav.signIn")}
                </Link>
              )}
            </div>
            <button
              type="button"
              className={styles.profile}
              aria-expanded={profileOpen}
              aria-controls={profileId}
              onClick={() => setProfileOpen((o) => !o)}
            >
              <span className={styles.profilePicture} data-signed-out={user ? undefined : ""}>
                <AccountPicture user={user} />
              </span>
              <span className={styles.profileName}>{user ? user.name.trim() || user.email : t(lang, "nav.account")}</span>
            </button>
            <Link
              href="/settings"
              className={styles.menuRow}
              aria-current={pathname === "/settings" ? "page" : undefined}
              onClick={() => {
                saveDraftForSignIn();
                close();
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden className={styles.menuIcon}>
                <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth={1.8} />
                <path
                  d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                />
              </svg>
              {t(lang, "nav.settings")}
            </Link>
          </li>
        </ul>
      </nav>
      <button type="button" className={styles.scrim} tabIndex={-1} aria-label={t(lang, "case.cancel")} onClick={close} />
    </dialog>
  );
}
