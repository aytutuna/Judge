"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { saveDraftForSignIn } from "@/lib/draft";
import { t, type Key, type Lang } from "@/lib/i18n";
import { useViewer } from "@/lib/use-viewer";
import { titleOf } from "./HistoryList";
import { useHistory } from "./useHistory";
import styles from "./shell.module.css";

const RECENT = 5;

type Props = {
  lang: Lang;
  pathname: string | null;
  onHome?: () => void;
};

/** The phone's menu, as in the native app: a button in the header that opens
 * a panel with New, Verdicts, the newest few verdicts and Settings (where the
 * account lives). `onHome` resets the home page instead of navigating to
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
          <li>{row("/verdicts", "nav.verdicts")}</li>
          {recent.map((item) => (
            <li key={`${item.kind}-${item.id}`}>
              {item.href ? (
                <Link href={item.href} className={styles.recent} onClick={close}>
                  {titleOf(lang, item)}
                </Link>
              ) : (
                <span className={styles.recent} data-removed="">
                  {titleOf(lang, item)}
                </span>
              )}
            </li>
          ))}
          <li className={styles.menuEnd}>{row("/settings", "nav.settings", saveDraftForSignIn)}</li>
        </ul>
      </nav>
      <button type="button" className={styles.scrim} tabIndex={-1} aria-label={t(lang, "case.cancel")} onClick={close} />
    </dialog>
  );
}
