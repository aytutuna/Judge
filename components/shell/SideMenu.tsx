"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { accountEntry, AccountPicture, returnPath, signOutNow } from "@/components/AccountMenu";
import { saveDraftForSignIn } from "@/lib/draft";
import { t, type Key, type Lang } from "@/lib/i18n";
import { useViewer } from "@/lib/use-viewer";
import { liveLabel, stateLabel, titleOf, tone } from "./history-labels";
import { removeItems } from "./history-remove";
import { loadAllHistory, useHistory, type HistoryItem } from "./useHistory";
import { useLive } from "./useLive";
import styles from "./shell.module.css";

/** Which headings are folded, kept for the session. */
const folded = { verdicts: false, links: false };

type Confirm = { kind: HistoryItem["kind"]; ids: string[] | null };

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
  const waiting = links.some((i) => i.role === "owner" && i.state === "waiting");
  const live = useLive(waiting);
  const user = viewer.me?.user ?? null;
  const showSignIn = accountEntry(viewer.config, viewer.me) === "signin" && !pathname?.startsWith("/signin");
  const [profileOpen, setProfileOpen] = useState(false);
  const profileId = useId();
  const [, setFolds] = useState(0);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(0);
  const [limited, setLimited] = useState<string | null>(null);

  const targets = confirm
    ? history.items.filter(
        (i) => i.kind === confirm.kind && i.removable && (confirm.ids === null || confirm.ids.includes(i.id)),
      )
    : [];

  function toggle(which: "verdicts" | "links") {
    folded[which] = !folded[which];
    setFolds((n) => n + 1);
  }

  async function removeAll(kind: HistoryItem["kind"]) {
    setFailed(0);
    setBusy(true);
    await loadAllHistory();
    setBusy(false);
    setConfirm({ kind, ids: null });
  }

  async function run() {
    setBusy(true);
    const res = await removeItems(targets, lang);
    setBusy(false);
    setConfirm(null);
    setFailed(res.failed);
    setLimited(res.limited);
  }

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

  function confirmText(c: Confirm, n: number) {
    return t(lang, c.kind === "case" ? "shell.removeLinksConfirm" : "shell.removeConfirm", { n });
  }

  function section(heading: Key, which: "verdicts" | "links", items: HistoryItem[]) {
    if (items.length === 0) return null;
    const isFolded = folded[which];
    const listId = `${profileId}-${which}`;
    const kind = which === "links" ? "case" : "verdict";
    return (
      <section>
        <div className={styles.menuHeadRow}>
          <h2 className={styles.menuHeading}>
            <button
              type="button"
              className={styles.fold}
              aria-expanded={!isFolded}
              aria-controls={listId}
              onClick={() => toggle(which)}
            >
              <svg viewBox="0 0 24 24" aria-hidden className={styles.chevron} data-folded={isFolded ? "" : undefined}>
                <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t(lang, heading)}
            </button>
          </h2>
          {items.some((i) => i.removable) ? (
            <button type="button" className={styles.removeAll} disabled={busy} onClick={() => void removeAll(kind)}>
              {t(lang, "shell.removeAll")}
            </button>
          ) : null}
        </div>
        <ul id={listId} hidden={isFolded}>
          {items.map((item) => {
            const typing = item.kind === "case" && item.state === "waiting" ? liveLabel(lang, live.get(item.id)) : null;
            const state = typing ?? (item.kind === "verdict" && item.state === "removed" ? null : stateLabel(lang, item));
            const inner = (
              <>
                <span className={styles.recentTitle}>{titleOf(lang, item)}</span>
                {state ? (
                  <span className={styles.recentState} data-live={typing ? "" : undefined}>
                    {state}
                  </span>
                ) : null}
              </>
            );
            return (
              <li key={`${item.kind}-${item.id}`} className={styles.recentItem}>
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
                {item.removable ? (
                  <button
                    type="button"
                    className={styles.trash}
                    aria-label={t(lang, item.kind === "verdict" ? "verdict.remove" : "case.remove")}
                    disabled={busy}
                    onClick={() => {
                      setFailed(0);
                      setConfirm({ kind: item.kind, ids: [item.id] });
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden>
                      <path
                        d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ) : null}
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
          {section("nav.verdicts", "verdicts", verdicts)}
          {section("nav.links", "links", links)}
          {history.items.length === 0 ? (
            history.status === "loading" ? (
              <p className={styles.note} role="status">
                {t(lang, "shell.loading")}
              </p>
            ) : history.status === "error" ? null : (
              <p className={styles.note}>{t(lang, "shell.empty")}</p>
            )
          ) : null}
          {history.status === "error" ? (
            <>
              <p className={styles.note} role="alert">
                {t(lang, "shell.loadFailed")}
              </p>
              <button type="button" className={styles.more} onClick={history.refresh}>
                {t(lang, "case.retry")}
              </button>
            </>
          ) : null}
          {failed > 0 ? (
            <p className={styles.note} role="alert">
              {t(lang, "shell.removeFailed", { n: failed })}
            </p>
          ) : null}
          {history.more ? (
            <button type="button" className={styles.more} disabled={history.loadingMore} onClick={history.loadMore}>
              {history.loadingMore ? t(lang, "shell.loading") : t(lang, "shell.loadMore")}
            </button>
          ) : null}
        </div>
        {confirm && targets.length > 0 ? (
          <div className={styles.confirm} role="alertdialog" aria-label={confirmText(confirm, targets.length)}>
            <p>{confirmText(confirm, targets.length)}</p>
            <div className={styles.confirmButtons}>
              <button type="button" className={styles.more} disabled={busy} onClick={() => setConfirm(null)}>
                {t(lang, "case.cancel")}
              </button>
              <button type="button" className={styles.confirmYes} disabled={busy} onClick={() => void run()}>
                {t(lang, confirm.ids === null ? "shell.removeAll" : "verdict.remove.yes")}
              </button>
            </div>
          </div>
        ) : null}
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
