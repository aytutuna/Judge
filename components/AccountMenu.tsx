"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
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
 * The nav's account entry: a "Sign in" link when signed out, or an initial
 * avatar that opens a small disclosure list (Account, Pricing, Sign out).
 * Renders nothing on the server and until the viewer store has answered.
 */
export function AccountMenu({ lang }: { lang: Lang }) {
  const { me, config } = useViewer();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const entry = accountEntry(config, me);
  if (entry === "none") return null;

  if (entry === "signin" || !me?.user) {
    if (pathname?.startsWith("/signin")) return null;
    return (
      <Link
        href={`/signin?next=${encodeURIComponent(returnPath(pathname))}`}
        className={styles.signIn}
        onClick={saveDraftForSignIn}
      >
        {t(lang, "nav.signIn")}
      </Link>
    );
  }

  const user = me.user;
  async function signOutNow() {
    setOpen(false);
    try {
      const { signOut } = await import("@/lib/auth-client");
      await signOut();
    } finally {
      markSignedOut();
    }
  }

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={styles.avatar}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t(lang, "nav.accountMenu")}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden>{initialOf(user.name, user.email)}</span>
      </button>
      <div id={panelId} className={styles.panel} hidden={!open}>
        <p className={styles.who}>{user.email}</p>
        <ul className={styles.items}>
          <li>
            <Link href="/account" className={styles.item} onClick={() => setOpen(false)}>
              {t(lang, "nav.account")}
            </Link>
          </li>
          <li>
            <Link href="/pricing" className={styles.item} onClick={() => setOpen(false)}>
              {t(lang, "nav.pricing")}
            </Link>
          </li>
          <li>
            <button type="button" className={styles.item} onClick={() => void signOutNow()}>
              {t(lang, "nav.signOut")}
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}
