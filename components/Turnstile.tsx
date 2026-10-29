"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { t, type Lang } from "@/lib/i18n";

/** Inlined at build time; empty means "no human check" (local dev). */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

type RenderOptions = {
  sitekey: string;
  theme?: "auto" | "light" | "dark";
  size?: "normal" | "flexible" | "compact";
  language?: string;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: RenderOptions) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let loader: Promise<TurnstileApi> | null = null;

/** Inject the Turnstile script once per page; later mounts reuse it. A failed
 * load clears the cache so a remount can retry. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loader ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile missing"));
    script.onerror = () => {
      loader = null;
      script.remove();
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return loader;
}

/**
 * Cloudflare Turnstile widget. Tokens are single-use: the parent mounts this
 * only while the form is shown, so every return to the form (after a verdict
 * or an error) renders a fresh widget and a fresh token. `onToken(null)`
 * means "no valid token right now" (expired, errored, or not yet solved).
 */
export function Turnstile({
  siteKey,
  lang,
  onToken,
}: {
  siteKey: string;
  lang: Lang;
  onToken: (token: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const emit = useEffectEvent(onToken);

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !ref.current) return;
        setFailed(false);
        widgetId = api.render(ref.current, {
          sitekey: siteKey,
          theme: "auto",
          size: "flexible",
          language: lang,
          callback: (token) => emit(token),
          "expired-callback": () => emit(null),
          "error-callback": () => emit(null),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        emit(null);
      });
    return () => {
      cancelled = true;
      if (widgetId !== null) window.turnstile?.remove(widgetId);
      emit(null);
    };
  }, [siteKey, lang]);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={ref}
        aria-label={t(lang, "turnstile.label")}
        role="group"
        className="min-h-[65px]"
      />
      {failed ? (
        <p className="text-[13px] leading-snug text-center text-danger" role="alert">
          {t(lang, "turnstile.error")}
        </p>
      ) : null}
    </div>
  );
}
