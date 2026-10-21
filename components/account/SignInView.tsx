"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import type { AuthProviders } from "@/lib/account-types";
import { t, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { refreshViewer, useViewer } from "@/lib/use-viewer";
import { Turnstile, TURNSTILE_SITE_KEY } from "../Turnstile";
import styles from "./AccountPages.module.css";
import { PageShell } from "./PageShell";

const NEXT_BASE = "http://next.invalid";
// Control characters and spaces: URL parsing strips tabs and newlines, so
// "/\t/evil.com" would turn into "//evil.com".
const UNSAFE_CHARS = /[\u0000- \u007f]/;

/** A same-origin path to return to after signing in; anything else (full
 * URLs, protocol-relative `//host`, backslash or control-character tricks,
 * dot segments that collapse into `//host`) falls back. The value is
 * resolved the way the browser will resolve it, and the normalized path is
 * what comes back. */
export function safeNext(raw: string | string[] | undefined, fallback = "/account"): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (
    typeof v !== "string" ||
    !v.startsWith("/") ||
    v.startsWith("//") ||
    v.includes("\\") ||
    UNSAFE_CHARS.test(v)
  ) {
    return fallback;
  }
  let url: URL;
  try {
    url = new URL(v, NEXT_BASE);
  } catch {
    return fallback;
  }
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (url.origin !== NEXT_BASE || path.startsWith("//") || path.includes("\\")) return fallback;
  if (url.pathname.startsWith("/signin")) return fallback;
  return path;
}

/** `path` with `lang` in its query: the magic-link email is written in the
 * language the callback URL carries. */
export function withLang(path: string, lang: Lang): string {
  const u = new URL(path, "http://local");
  u.searchParams.set("lang", lang);
  return `${u.pathname}${u.search}${u.hash}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NO_PROVIDERS: AuthProviders = { apple: false, google: false, email: false, emailCode: false, dev: false };

function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={styles.logo}>
      <path
        fill="currentColor"
        d="M16.37 12.6c-.02-2.13 1.74-3.15 1.82-3.2-1-1.45-2.54-1.65-3.08-1.67-1.31-.13-2.56.77-3.22.77-.67 0-1.69-.75-2.78-.73-1.43.02-2.75.83-3.48 2.11-1.49 2.58-.38 6.39 1.07 8.48.71 1.02 1.55 2.17 2.65 2.13 1.07-.04 1.47-.69 2.76-.69 1.29 0 1.65.69 2.78.67 1.15-.02 1.87-1.04 2.57-2.07.81-1.18 1.14-2.33 1.16-2.39-.03-.01-2.22-.85-2.25-3.41ZM14.25 6.34c.59-.71.98-1.7.87-2.69-.85.03-1.87.56-2.48 1.27-.54.63-1.02 1.64-.89 2.61.94.07 1.91-.48 2.5-1.19Z"
      />
    </svg>
  );
}

/** Google's multicolour "G": its brand rules require the original colours,
 * so this mark is the one place outside the palette. */
function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={styles.logo}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38Z" />
    </svg>
  );
}

export type SignInPanelProps = {
  lang: Lang;
  /** Null while the deployment's config is still loading. */
  providers: AuthProviders | null;
  pending: boolean;
  error: string | null;
  emailOpen: boolean;
  email: string;
  sentTo: string | null;
  captcha: React.ReactNode;
  canSendEmail: boolean;
  onProvider: (p: "apple" | "google") => void;
  onToggleEmail: () => void;
  onEmail: (value: string) => void;
  onSendEmail: () => void;
  onDev: () => void;
};

/** The sign-in card, stateless so tests can render every state. */
export function SignInPanel({
  lang,
  providers,
  pending,
  error,
  emailOpen,
  email,
  sentTo,
  captcha,
  canSendEmail,
  onProvider,
  onToggleEmail,
  onEmail,
  onSendEmail,
  onDev,
}: SignInPanelProps) {
  const emailFormId = useId();
  const loading = providers === null;
  const none = providers !== null && !providers.apple && !providers.google && !providers.email && !providers.dev;

  const providerButton = (p: "apple" | "google") => {
    const available = providers?.[p] === true;
    return (
      <button
        type="button"
        className={`${styles.btn} ${p === "apple" && available ? styles.primary : styles.secondary}`}
        disabled={!available || pending}
        onClick={() => onProvider(p)}
      >
        {p === "apple" ? <AppleLogo /> : <GoogleLogo />}
        <span className={styles.btnLabel}>
          {t(lang, p === "apple" ? "signin.apple" : "signin.google")}
          {!loading && !available ? (
            <span className={styles.btnSub}>{t(lang, "signin.providerUnavailable")}</span>
          ) : null}
        </span>
      </button>
    );
  };

  return (
    <div className={styles.card}>
      <p className={loading ? styles.muted : "sr-only"} role="status" aria-live="polite">
        {loading ? t(lang, "signin.loading") : ""}
      </p>
      {none ? <p className={styles.notice}>{t(lang, "signin.unavailable")}</p> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {providerButton("apple")}
      {providerButton("google")}

      {providers?.email ? (
        <>
          <div className={styles.divider} aria-hidden />
          {sentTo ? (
            <p className={styles.ok} role="status">
              {t(lang, "signin.emailSent", { email: sentTo })}
            </p>
          ) : (
            <>
              <button
                type="button"
                className={styles.textBtn}
                aria-expanded={emailOpen}
                aria-controls={emailFormId}
                onClick={onToggleEmail}
              >
                {t(lang, "signin.emailToggle")}
              </button>
              <form
                id={emailFormId}
                hidden={!emailOpen}
                className={styles.field}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canSendEmail) onSendEmail();
                }}
              >
                <label className={styles.label} htmlFor={`${emailFormId}-email`}>
                  {t(lang, "signin.emailLabel")}
                </label>
                <input
                  id={`${emailFormId}-email`}
                  className={styles.input}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  placeholder={t(lang, "signin.emailPlaceholder")}
                  onChange={(e) => onEmail(e.target.value)}
                />
                {emailOpen ? captcha : null}
                <button
                  type="submit"
                  className={`${styles.btn} ${styles.secondary}`}
                  disabled={!canSendEmail || pending}
                >
                  {t(lang, "signin.emailSubmit")}
                </button>
              </form>
            </>
          )}
        </>
      ) : null}

      {providers?.dev ? (
        <div className={styles.devBox}>
          <button
            type="button"
            className={`${styles.btn} ${styles.secondary}`}
            disabled={pending}
            onClick={onDev}
          >
            {t(lang, "signin.dev")}
          </button>
          <p className={styles.small}>{t(lang, "signin.devNote")}</p>
        </div>
      ) : null}

      <p className={styles.small}>
        {t(lang, "signin.legal")}{" "}
        <Link href="/privacy" className={styles.link}>
          {t(lang, "signin.legalLink")}
        </Link>
        {t(lang, "signin.legalAfter")}
      </p>
    </div>
  );
}

/** /signin: Apple and Google first, email link as an extra, the dev test
 * login only where the server reports it. Signed-in visitors go to
 * /account. `next` is the raw ?next= value. */
export function SignInView({ next: rawNext }: { next?: string | string[] }) {
  const lang = useLang();
  const router = useRouter();
  const { me, config, status } = useViewer();
  const next = safeNext(rawNext);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const signedIn = Boolean(me?.user);
  useEffect(() => {
    if (signedIn) router.replace(next);
  }, [signedIn, next, router]);

  const needsCaptcha = TURNSTILE_SITE_KEY !== "";
  const canSendEmail = EMAIL_RE.test(email.trim()) && (!needsCaptcha || captchaToken !== null);

  async function provider(p: "apple" | "google") {
    setPending(true);
    setError(null);
    const { signInWithProvider } = await import("@/lib/auth-client");
    const res = await signInWithProvider(p, next);
    // Success leaves the page for Apple or Google; only failure lands here.
    if (!res.ok) {
      setError(t(lang, "signin.failed"));
      setPending(false);
    }
  }

  async function sendEmail() {
    const to = email.trim();
    if (!EMAIL_RE.test(to)) {
      setError(t(lang, "signin.emailInvalid"));
      return;
    }
    setPending(true);
    setError(null);
    const token = captchaToken ?? undefined;
    setCaptchaToken(null);
    const { sendMagicLink } = await import("@/lib/auth-client");
    const res = await sendMagicLink(to, withLang(next, lang), token);
    setPending(false);
    if (res.ok) setSentTo(to);
    else setError(t(lang, "signin.failed"));
  }

  async function dev() {
    setPending(true);
    setError(null);
    const { devLogin } = await import("@/lib/auth-client");
    const res = await devLogin();
    if (!res.ok) {
      setError(t(lang, "signin.failed"));
      setPending(false);
      return;
    }
    // The store now has a user, and the effect above takes it to `next`.
    await refreshViewer();
  }

  return (
    <PageShell
      lang={lang}
      kicker={t(lang, "nav.account")}
      title={t(lang, "signin.title")}
      lead={t(lang, "signin.lead")}
    >
      <SignInPanel
        lang={lang}
        providers={config?.signIn ?? (status === "ready" || status === "error" ? NO_PROVIDERS : null)}
        pending={pending || signedIn}
        error={error}
        emailOpen={emailOpen}
        email={email}
        sentTo={sentTo}
        captcha={
          needsCaptcha && !pending ? (
            <Turnstile siteKey={TURNSTILE_SITE_KEY} lang={lang} onToken={setCaptchaToken} />
          ) : null
        }
        canSendEmail={canSendEmail}
        onProvider={(p) => void provider(p)}
        onToggleEmail={() => setEmailOpen((o) => !o)}
        onEmail={setEmail}
        onSendEmail={() => void sendEmail()}
        onDev={() => void dev()}
      />
    </PageShell>
  );
}
