"use client";

import { useState, useSyncExternalStore } from "react";
import { t, type Lang } from "@/lib/i18n";

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

  const primary = {
    background: "var(--ink)",
    color: "var(--plane)",
  };
  const secondary = {
    background: "var(--surface)",
    color: "var(--ink)",
    border: "1px solid var(--ring)",
  };

  return (
    <div className={["flex flex-wrap justify-center gap-2", className].filter(Boolean).join(" ")}>
      {nativeShare ? (
        <button
          type="button"
          onClick={share}
          className="rounded-full px-5 py-3 text-sm font-semibold"
          style={primary}
        >
          {t(lang, "share")}
        </button>
      ) : null}
      <button
        type="button"
        onClick={copyLink}
        className="rounded-full px-5 py-3 text-sm font-semibold"
        style={nativeShare ? secondary : primary}
      >
        <span aria-live="polite">{copied ? t(lang, "copied") : t(lang, "copyLink")}</span>
      </button>
    </div>
  );
}
