"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { track } from "@/lib/analytics/client";
import { t, tWithDate, type Lang } from "@/lib/i18n";
import account from "../account/AccountPages.module.css";
import styles from "./case.module.css";

function subscribeNever(): () => void {
  return () => {};
}
function canNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}
function serverCanShare(): boolean {
  return false;
}

/**
 * The owner's private invite link: a read-only field (selected on focus),
 * Copy, the native share sheet where the browser has one, the expiry date,
 * and "Make a new link", which turns the old one off (the caller confirms
 * first: `onReset` opens that dialog). The native share
 * button appears only after hydration so server and client markup agree.
 */
export function InviteLink({
  lang,
  url,
  expiresAt,
  onReset,
  resetting = false,
  resetDone = false,
}: {
  lang: Lang;
  url: string;
  expiresAt: string;
  onReset?: () => void;
  resetting?: boolean;
  resetDone?: boolean;
}) {
  const nativeShare = useSyncExternalStore(subscribeNever, canNativeShare, serverCanShare);
  const [copied, setCopied] = useState(false);
  const fieldId = useId();
  const expiryId = useId();

  async function copy() {
    track("share_tapped");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t(lang, "copyPrompt"), url);
    }
  }

  async function share() {
    track("share_tapped");
    try {
      await navigator.share({ text: t(lang, "case.invite.shareText"), url });
    } catch {
      // Dismissing the share sheet rejects with AbortError; nothing to do.
    }
  }

  return (
    <div className={styles.invite}>
      <label htmlFor={fieldId} className={styles.inviteLabel}>
        {t(lang, "case.invite.label")}
      </label>
      <input
        id={fieldId}
        className={styles.inviteField}
        value={url}
        readOnly
        aria-describedby={expiryId}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className={styles.inviteActions}>
        <button type="button" className={`${account.btn} ${account.primary}`} onClick={() => void copy()}>
          <span aria-live="polite">{t(lang, copied ? "case.invite.copied" : "case.invite.copy")}</span>
        </button>
        {nativeShare ? (
          <button type="button" className={`${account.btn} ${account.secondary}`} onClick={() => void share()}>
            {t(lang, "case.invite.share")}
          </button>
        ) : null}
      </div>
      <p id={expiryId} className={styles.note}>
        {tWithDate(lang, "case.invite.expires", expiresAt)}
      </p>
      {onReset ? (
        <button type="button" className={styles.textBtn} onClick={onReset} disabled={resetting}>
          {t(lang, "case.invite.reset")}
        </button>
      ) : null}
      <p className={resetDone ? styles.calm : "sr-only"} role="status">
        {resetDone ? t(lang, "case.invite.resetDone") : ""}
      </p>
    </div>
  );
}
