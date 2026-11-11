"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { accountEntry, AccountPicture, returnPath, signOutNow } from "@/components/AccountMenu";
import { saveDraftForSignIn } from "@/lib/draft";
import { t, type Key, type Lang } from "@/lib/i18n";
import { useViewer } from "@/lib/use-viewer";
import { stateLabel, titleOf, tone } from "./history-labels";
import { useHistory, type HistoryItem } from "./useHistory";
import styles from "./shell.module.css";

type Props = {
  lang: Lang;
  pathname: string | null;
  onHome?: () => void;
};

/** The menu, as in the native app: a button in the header that opens a panel
 * with New, the Verdicts and the Links (cases sent and received) in two
 * lists that scroll, and at the bottom the profile (Pricing, Sign in or Sign
 * out) above Settings. `onHome` resets the home page instead of navigating
 * to itself. */
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
  const history = useHistory(viewer, true);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const root = document.documentElement;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = "";
    };
  }, []);

  const close = () => dialogRef.current?.close();
  const verdicts = history.items.filter((i) => i.kind === "verdict");
  const links = history.items.filter((i) => i.kind === "case");
  const user = viewer.me?.user ?? null;
  const showSignIn = accountEntry(viewer.config, viewer.me) === "signin" && !pathname?.startsWith("/signin");
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

  function section(heading: Key, items: HistoryItem[]) {
    if (items.length === 0) return null;
    return (
      <section>
        <h2 className={styles.menuHeading}>{t(lang, heading)}</h2>
        <ul>
          {items.map((item) => {
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
                  <Link
                    href={item.href}
                    className={styles.recent}
                    data-tone={tone(item)}
                    data-removed={item.removed || item.state === "expired" ? "" : undefined}
                    onClick={close}
                  >
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
        </ul>
      </section>
    );
  }

  return (
    <dialog ref={dialogRef} className={styles.menu} aria-label={t(lang, "nav.tabs")} onClose={onClosed}>
      <nav className={styles.panel} aria-label={t(lang, "nav.tabs")}>
        {row("/", "nav.new", (e) => {
          if (!onHome) return;
          e.preventDefault();
          onHome();
        })}
        <div className={styles.menuList}>
          {showSignIn ? (
            <p className={styles.local}>
              {t(lang, "shell.local")}{" "}
              <Link
                href={`/signin?next=${encodeURIComponent(returnPath(pathname))}`}
                onClick={() => {
                  saveDraftForSignIn();
                  close();
                }}
              >
                {t(lang, "shell.localSignIn")}
              </Link>
            </p>
          ) : null}
          {section("nav.verdicts", verdicts)}
          {section("nav.links", links)}
          {history.items.length === 0 ? (
            history.status === "loading" ? (
              <p className={styles.note} role="status">
                {t(lang, "shell.loading")}
              </p>
            ) : (
              <p className={styles.note}>{t(lang, history.status === "error" ? "shell.loadFailed" : "shell.empty")}</p>
            )
          ) : null}
          {history.more ? (
            <button type="button" className={styles.more} disabled={history.loadingMore} onClick={history.loadMore}>
              {history.loadingMore ? t(lang, "shell.loading") : t(lang, "shell.loadMore")}
            </button>
          ) : null}
        </div>
        <div className={styles.menuEnd}>
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
            ) : showSignIn ? (
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
            ) : null}
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
        </div>
      </nav>
      <button type="button" className={styles.scrim} tabIndex={-1} aria-label={t(lang, "case.cancel")} onClick={close} />
    </dialog>
  );
}
