"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { AppConfig, MeResponse } from "@/lib/account-types";
import { saveDraftForSignIn } from "@/lib/draft";
import { t, type Lang } from "@/lib/i18n";
import { markSignedOut, signInOffered, useViewer } from "@/lib/use-viewer";
import styles from "./AccountMenu.module.css";

/** Whether the nav shows an account entry at all: only once /me and
 * /config have answered, and only where someone can actually sign in (or
 * already has). A deployment without auth keeps today's nav. */
export function accountEntry(
  config: AppConfig | null,
  me: MeResponse | null,
): "none" | "signin" | "menu" {
  if (me?.user) return "menu";
  return signInOffered(config) ? "signin" : "none";
}

/** First letter of the name (or email) for the avatar circle. */
export function initialOf(name: string, email: string): string {
  const source = name.trim() || email.trim();
  return source ? source.slice(0, 1).toLocaleUpperCase() : "?";
}

/** Same-origin path to come back to after signing in. */
function returnPath(pathname: string | null): string {
  return pathname && pathname.startsWith("/") && !pathname.startsWith("/signin") ? pathname : "/";
}

/**
 * The nav's one account entry: a profile picture (their image, else their
 * initial, else a plain silhouette when signed out) that opens a menu with
 * Sign in or Sign out, Settings and Pricing. Server-rendered closed, as the
 * signed-out silhouette, until the viewer store answers.
 */
export function AccountMenu({ lang }: { lang: Lang }) {
  const { me, config } = useViewer();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const user = me?.user ?? null;
  const entry = accountEntry(config, me);
  const showSignIn = entry === "signin" && !pathname?.startsWith("/signin");

  async function signOutNow() {
    setOpen(false);
    buttonRef.current?.focus();
    try {
      const { signOut } = await import("@/lib/auth-client");
      await signOut();
    } finally {
      markSignedOut();
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (!open || at < 0) return;
    const next =
      e.key === "ArrowDown" ? (at + 1) % items.length
      : e.key === "ArrowUp" ? (at - 1 + items.length) % items.length
      : e.key === "Home" ? 0
      : e.key === "End" ? items.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    items[next].focus();
  }

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={styles.avatar}
        data-signed-out={user ? undefined : ""}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t(lang, "nav.accountMenu")}
        onClick={() => setOpen((o) => !o)}
      >
        {user ? (
          user.image && failedImage !== user.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- a provider's avatar URL
            <img src={user.image} alt="" referrerPolicy="no-referrer" onError={() => setFailedImage(user.image)} />
          ) : (
            <span aria-hidden>{initialOf(user.name, user.email)}</span>
          )
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden>
            <circle cx="12" cy="9" r="4" fill="currentColor" />
            <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" fill="currentColor" />
          </svg>
        )}
      </button>
      <div
        id={panelId}
        ref={panelRef}
        className={styles.panel}
        hidden={!open}
        onMouseDown={(e) => e.preventDefault()}
      >
        {user ? <p className={styles.who}>{user.email}</p> : null}
        <ul className={styles.items} role="menu" aria-label={t(lang, "nav.accountMenu")}>
          {showSignIn ? (
            <li role="none">
              <Link
                href={`/signin?next=${encodeURIComponent(returnPath(pathname))}`}
                role="menuitem"
                className={styles.item}
                onClick={() => {
                  saveDraftForSignIn();
                  setOpen(false);
                }}
              >
                {t(lang, "nav.signIn")}
              </Link>
            </li>
          ) : null}
          <li role="none">
            <Link
              href="/settings"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                saveDraftForSignIn();
                setOpen(false);
              }}
            >
              {t(lang, "nav.settings")}
            </Link>
          </li>
          <li role="none">
            <Link href="/pricing" role="menuitem" className={styles.item} onClick={() => setOpen(false)}>
              {t(lang, "nav.pricing")}
            </Link>
          </li>
          {user ? (
            <li role="none">
              <button type="button" role="menuitem" className={styles.item} onClick={() => void signOutNow()}>
                {t(lang, "nav.signOut")}
              </button>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
