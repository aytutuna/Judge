"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { t, type Lang } from "@/lib/i18n";
import { stripLeadingEmoji } from "@/lib/text";
import { ShareDialog, type OwnerShare } from "./ShareDialog";
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

/** Whether a share or copy opens the names dialog first. Asked once per
 * verdict: not when the names were saved in this page view
 * (`confirmedHere`), saved before on any device (the server remembers it,
 * even when the writer kept the label or switched names off), or the
 * writer's own name is already chosen. Never for public viewers. Pure. */
export function needsNamesPrompt(owner: OwnerShare | undefined, confirmedHere: boolean): boolean {
  return Boolean(owner) && !confirmedHere && !owner?.namesConfirmed && owner?.display.a == null;
}

/** Copy-link plus native share sheet (where the browser has one). The native
 * button only appears after hydration so server and client markup agree.
 * For the verdict's writer (`owner`), the first share or copy opens the
 * names dialog first (how they appear, the others' names, names on or off),
 * then goes on with the share; public viewers get the buttons alone. */
export function ShareButtons({
  shareId,
  title,
  lang,
  className,
  owner,
}: {
  shareId: string;
  title: string;
  lang: Lang;
  className?: string;
  owner?: OwnerShare;
}) {
  const nativeShare = useSyncExternalStore(subscribeNever, canNativeShare, serverCanShare);
  const [copied, setCopied] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const needsNames = needsNamesPrompt(owner, confirmed);

  function withNames(action: () => void) {
    if (!needsNames) return action();
    pending.current = action;
    setDialogOpen(true);
  }

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
        <button type="button" onClick={() => withNames(() => void share())} className={styles.btnGhost}>
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
      <button type="button" onClick={() => withNames(() => void copyLink())} className={styles.btnGhost}>
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
      {owner ? (
        <ShareDialog
          open={dialogOpen}
          lang={lang}
          owner={owner}
          saveLabel={t(lang, "names.saveShare")}
          onClose={() => setDialogOpen(false)}
          onDone={() => {
            setConfirmed(true);
            const action = pending.current;
            pending.current = null;
            action?.();
          }}
        />
      ) : null}
    </div>
  );
}
