"use client";

import { useState, useSyncExternalStore } from "react";
import { t, type Lang } from "@/lib/i18n";
import { stripLeadingEmoji } from "@/lib/text";
import styles from "./verdict/verdict.module.css";

function subscribeNever(): () => void {
  return () => {};
}
function canNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}
function serverCanShare(): boolean {
  return false;
}

/** Copy-link plus native share sheet (where the browser has one). The native
 * button only appears after hydration so server and client markup agree. */
export function ShareButtons({
  shareId,
  title,
  lang,
  className,
}: {
  shareId: string;
  title: string;
  lang: Lang;
  className?: string;
}) {
  const nativeShare = useSyncExternalStore(subscribeNever, canNativeShare, serverCanShare);
  const [copied, setCopied] = useState(false);

  const url = () => `${window.location.origin}/v/${shareId}`;

  async function copyLink() {
    const link = url();
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t(lang, "copyPrompt"), link);
    }
  }

  async function share() {
    try {
      await navigator.share({ title, text: t(lang, "shareText"), url: url() });
    } catch {
      // Dismissing the share sheet rejects with AbortError; nothing to do.
    }
  }

  return (
    <div className={[styles.shareGroup, className].filter(Boolean).join(" ")}>
      {nativeShare ? (
        <button type="button" onClick={share} className={styles.btnGhost}>
          <svg viewBox="0 0 16 16" aria-hidden>
            <path
              d="M8 10V2.5M5 5.2 8 2.2l3 3M4 8H3.5A1.5 1.5 0 0 0 2 9.5v3A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5v-3A1.5 1.5 0 0 0 12.5 8H12"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {stripLeadingEmoji(t(lang, "share"))}
        </button>
      ) : null}
      <button type="button" onClick={copyLink} className={styles.btnGhost}>
        {copied ? (
          <svg viewBox="0 0 16 16" aria-hidden>
            <path
              d="M3.5 8.4 6.6 11.4 12.6 4.9"
              fill="none"
              stroke="var(--sage-ink)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden>
            <path
              d="M6.5 9.5 9.5 6.5M7 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L5.5 8"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          </svg>
        )}
        <span aria-live="polite">
          {stripLeadingEmoji(copied ? t(lang, "copied") : t(lang, "copyLink"))}
        </span>
      </button>
    </div>
  );
}
