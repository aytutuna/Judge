"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { signInStarted, trackError } from "@/lib/analytics/client";
import type { AuthProviders } from "@/lib/account-types";
import { t, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { refreshViewer, useViewer, viewerSignedIn } from "@/lib/use-viewer";
import { AdultCheck, forgetAdultTick, rememberAdultTick } from "../AgeGate";
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

export const CODE_LENGTH = 6;

/** Digits only, at most six: what a typed or pasted code is cut down to.
 * Arabic-Indic and Persian digits become ASCII ones first. */
export function digitsOnly(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^0-9]/g, "")
    .slice(0, CODE_LENGTH);
}

/** What the email area is doing: sign in with a password, make an account
 * (password first, then the code), reset a password (code first, then the
 * password) or just sign in by code. */
export type SignInMode = "password" | "create" | "forgot" | "code";

const SENT_TO_KEY = "signin_sent_to";
const SENT_MODE_KEY = "signin_mode";
const KEPT_MODES: readonly string[] = ["create", "forgot", "code"];
export const PASSWORD_MIN = 8;

function readSentTo(): { email: string; mode: SignInMode } | null {
  try {
    const email = sessionStorage.getItem(SENT_TO_KEY);
    const mode = sessionStorage.getItem(SENT_MODE_KEY);
    return email ? { email, mode: mode && KEPT_MODES.includes(mode) ? (mode as SignInMode) : "code" } : null;
  } catch {
    return null;
  }
}

// Never the password: after a reload during "create" it is asked again once
// the code is in.
function keepSentTo(email: string | null, mode?: SignInMode): void {
  try {
    if (email) {
      sessionStorage.setItem(SENT_TO_KEY, email);
      sessionStorage.setItem(SENT_MODE_KEY, mode ?? "code");
    } else {
      sessionStorage.removeItem(SENT_TO_KEY);
      sessionStorage.removeItem(SENT_MODE_KEY);
    }
  } catch {
    // Private mode: the code step just does not survive a reload.
  }
}

const NO_PROVIDERS: AuthProviders = { apple: false, google: false, email: false, emailCode: false, password: false, dev: false };

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
  /** The emailed code being typed (email code sign-in, after `sentTo`). */
  code: string;
  captcha: React.ReactNode;
  canSendEmail: boolean;
  /** "I'm 18 or older" is ticked: nothing can be used until it is. */
  adult: boolean;
  mode: SignInMode;
  password: string;
  showPassword: boolean;
  /** Signed in by code and still choosing a password. */
  choosing: boolean;
  /** `error` belongs to the email area's fields, not the top of the card. */
  errorInForm: boolean;
  onAdult: (v: boolean) => void;
  onMode: (mode: SignInMode) => void;
  onPassword: (value: string) => void;
  onShowPassword: () => void;
  onSignInPassword: () => void;
  onSavePassword: () => void;
  onProvider: (p: "apple" | "google") => void;
  onToggleEmail: () => void;
  onEmail: (value: string) => void;
  onSendEmail: () => void;
  onCode: (value: string) => void;
  onVerify: () => void;
  onResend: () => void;
  onChangeEmail: () => void;
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
  code,
  captcha,
  canSendEmail,
  adult,
  mode,
  password,
  showPassword,
  choosing,
  errorInForm,
  onAdult,
  onMode,
  onPassword,
  onShowPassword,
  onSignInPassword,
  onSavePassword,
  onProvider,
  onToggleEmail,
  onEmail,
  onSendEmail,
  onCode,
  onVerify,
  onResend,
  onChangeEmail,
  onDev,
}: SignInPanelProps) {
  const emailFormId = useId();
  const loading = providers === null;
  const byCode = providers?.emailCode === true;
  const byPassword = byCode && providers?.password === true;
  const codeStep = Boolean(providers?.email && byCode && sentTo);
  const none = providers !== null && !providers.apple && !providers.google && !providers.email && !providers.dev;

  const providerButton = (p: "apple" | "google") => {
    const available = providers?.[p] === true;
    return (
      <button
        type="button"
        className={`${styles.btn} ${p === "apple" && available ? styles.primary : styles.secondary}`}
        disabled={!available || pending || !adult}
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

  const formError =
    errorInForm && error ? (
      <p id={`${emailFormId}-error`} className={styles.error} role="alert">
        {error}
      </p>
    ) : null;

  const passwordField = (kind: "current" | "new") => {
    const id = `${emailFormId}-${kind === "new" ? "newpw" : "pw"}`;
    return (
      <>
        <label className={styles.label} htmlFor={id}>
          {t(lang, kind === "new" ? "signin.passwordNew" : "signin.password")}
        </label>
        <input
          id={id}
          className={styles.input}
          type={showPassword ? "text" : "password"}
          autoComplete={kind === "new" ? "new-password" : "current-password"}
          required
          maxLength={128}
          aria-invalid={formError ? true : undefined}
          aria-describedby={formError ? `${emailFormId}-error` : undefined}
          value={password}
          onChange={(e) => onPassword(e.target.value)}
        />
        <button type="button" className={styles.textBtn} aria-pressed={showPassword} onClick={onShowPassword}>
          {t(lang, "signin.passwordShow")}
        </button>
      </>
    );
  };

  if (choosing) {
    return (
      <div className={styles.card}>
        <p className={styles.ok} role="status">
          {t(lang, "signin.passwordChoose")}
        </p>
        <form
          className={styles.field}
          onSubmit={(e) => {
            e.preventDefault();
            if (password !== "" && !pending) onSavePassword();
          }}
        >
          <input
            type="email"
            autoComplete="username"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            readOnly
            value={email || sentTo || ""}
          />
          {passwordField("new")}
          {formError}
          <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={password === "" || pending}>
            {t(lang, "signin.passwordSave")}
          </button>
        </form>
      </div>
    );
  }

  const emailArea =
    byPassword && !sentTo ? (
      <form
        className={styles.field}
        onSubmit={(e) => {
          e.preventDefault();
          if (!adult || pending || !canSendEmail) return;
          if (mode === "password") {
            if (password !== "") onSignInPassword();
          } else onSendEmail();
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
          autoComplete={mode === "password" || mode === "create" ? "username" : "email"}
          required
          value={email}
          placeholder={t(lang, "signin.emailPlaceholder")}
          onChange={(e) => onEmail(e.target.value)}
        />
        {mode === "password" || mode === "create" ? passwordField(mode === "create" ? "new" : "current") : null}
        {mode === "create" ? <p className={styles.small}>{t(lang, "signin.createNote")}</p> : null}
        {formError}
        <button
          type="submit"
          className={`${styles.btn} ${styles.secondary}`}
          disabled={!canSendEmail || pending || !adult || ((mode === "password" || mode === "create") && password === "")}
        >
          {t(lang, mode === "password" ? "signin.passwordSubmit" : "signin.codeRequest")}
        </button>
        {mode === "password" ? (
          <>
            <button type="button" className={styles.textBtn} disabled={pending} onClick={() => onMode("forgot")}>
              {t(lang, "signin.forgot")}
            </button>
            <button type="button" className={styles.textBtn} disabled={pending} onClick={() => onMode("create")}>
              {t(lang, "signin.create")}
            </button>
            <button type="button" className={styles.textBtn} disabled={pending} onClick={() => onMode("code")}>
              {t(lang, "signin.useCode")}
            </button>
          </>
        ) : (
          <button type="button" className={styles.textBtn} disabled={pending} onClick={() => onMode("password")}>
            {t(lang, "signin.usePassword")}
          </button>
        )}
      </form>
    ) : null;

  return (
    <div className={styles.card}>
      <p className={loading ? styles.muted : "sr-only"} role="status" aria-live="polite">
        {loading ? t(lang, "signin.loading") : ""}
      </p>
      {none ? <p className={styles.notice}>{t(lang, "signin.unavailable")}</p> : null}
      {error && !codeStep && !(errorInForm && byPassword) ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {none ? null : <AdultCheck lang={lang} checked={adult} onChange={onAdult} />}

      {providerButton("apple")}
      {providerButton("google")}

      {providers?.email ? (
        <>
          <div className={styles.divider} aria-hidden />
          {sentTo && byCode ? (
            <>
              <p id={`${emailFormId}-sent`} className={styles.ok} role="status">
                {t(lang, "signin.codeSent", { email: sentTo })}
              </p>
              <form
                className={styles.field}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (code.length === CODE_LENGTH && adult && !pending) onVerify();
                }}
              >
                <label className={styles.label} htmlFor={`${emailFormId}-code`}>
                  {t(lang, "signin.codeLabel")}
                </label>
                <input
                  id={`${emailFormId}-code`}
                  className={`${styles.input} ${styles.codeInput}`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  autoFocus
                  required
                  aria-invalid={error ? true : undefined}
                  aria-describedby={`${emailFormId}-sent${error ? ` ${emailFormId}-error` : ""}`}
                  value={code}
                  onChange={(e) => onCode(digitsOnly(e.target.value))}
                />
                {error ? (
                  <p id={`${emailFormId}-error`} className={styles.error} role="alert">
                    {error}
                  </p>
                ) : null}
                <button
                  type="submit"
                  className={`${styles.btn} ${styles.primary}`}
                  disabled={code.length !== CODE_LENGTH || pending || !adult}
                >
                  {t(lang, "signin.codeSubmit")}
                </button>
              </form>
              <button type="button" className={styles.textBtn} disabled={pending || !adult} onClick={onResend}>
                {t(lang, "signin.codeResend")}
              </button>
              <button type="button" className={styles.textBtn} disabled={pending} onClick={onChangeEmail}>
                {t(lang, "signin.changeEmail")}
              </button>
            </>
          ) : sentTo ? (
            <p className={styles.ok} role="status">
              {t(lang, "signin.emailSent", { email: sentTo })}
            </p>
          ) : emailArea ? (
            emailArea
          ) : (
            <>
              <button
                type="button"
                className={styles.textBtn}
                aria-expanded={emailOpen}
                aria-controls={emailFormId}
                disabled={!adult}
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
                  if (canSendEmail && adult) onSendEmail();
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
                {emailOpen && !byCode ? captcha : null}
                <button
                  type="submit"
                  className={`${styles.btn} ${styles.secondary}`}
                  disabled={!canSendEmail || pending || !adult}
                >
                  {t(lang, byCode ? "signin.codeRequest" : "signin.emailSubmit")}
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
            disabled={pending || !adult}
            onClick={onDev}
          >
            {t(lang, "signin.dev")}
          </button>
          <p className={styles.small}>{t(lang, "signin.devNote")}</p>
        </div>
      ) : null}

      <p className={styles.small}>
        {t(lang, "signin.legal")
          .split(/(\{terms\}|\{privacy\})/)
          .map((part, i) =>
            part === "{terms}" ? (
              <Link key={i} href="/terms" className={styles.link}>
                {t(lang, "signin.legalTerms")}
              </Link>
            ) : part === "{privacy}" ? (
              <Link key={i} href="/privacy" className={styles.link}>
                {t(lang, "signin.legalLink")}
              </Link>
            ) : (
              part
            ),
          )}
      </p>
    </div>
  );
}

/** /signin: Apple and Google first, then email with a password (or a code,
 * or a link), the dev test login only where the server reports it. Signed-in visitors go to
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
  const [code, setCode] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [adult, setAdult] = useState(false);
  const [mode, setMode] = useState<SignInMode>("password");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [errorInForm, setErrorInForm] = useState(false);

  const signedIn = Boolean(me?.user);
  // A mobile browser can reload the tab while the user reads the mail.
  useEffect(() => {
    const kept = readSentTo();
    if (!kept) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser storage
    setSentTo(kept.email);
    setMode(kept.mode);
  }, []);
  // Back here from Apple or Google without signing in, or a fresh visit:
  // whatever was ticked before no longer counts.
  useEffect(() => forgetAdultTick(), []);
  useEffect(() => {
    if (signedIn) router.replace(next);
  }, [signedIn, next, router]);

  // The code endpoints are not behind the widget (see lib/auth.ts); only the
  // magic link is.
  const byCode = config?.signIn.emailCode === true;
  const byPassword = byCode && config?.signIn.password === true;
  const needsCaptcha = TURNSTILE_SITE_KEY !== "" && !byCode;
  const canSendEmail = EMAIL_RE.test(email.trim()) && (!needsCaptcha || captchaToken !== null);

  function fail(message: string, inForm = true) {
    setError(message);
    setErrorInForm(inForm);
  }

  async function provider(p: "apple" | "google") {
    setPending(true);
    setError(null);
    rememberAdultTick();
    signInStarted(p);
    const { signInWithProvider } = await import("@/lib/auth-client");
    const res = await signInWithProvider(p, next);
    // Success leaves the page for Apple or Google; only failure lands here.
    if (!res.ok) {
      forgetAdultTick();
      trackError(res.code);
      fail(t(lang, "signin.failed"), false);
      setPending(false);
    }
  }

  async function signInPassword() {
    const to = email.trim();
    if (!EMAIL_RE.test(to)) {
      fail(t(lang, "signin.emailInvalid"));
      return;
    }
    setPending(true);
    setError(null);
    rememberAdultTick();
    signInStarted("password");
    const { signInWithPassword, passwordSignInErrorKey } = await import("@/lib/auth-client");
    const res = await signInWithPassword(to, password);
    if (!res.ok) {
      forgetAdultTick();
      trackError(res.code);
      fail(t(lang, passwordSignInErrorKey(res)));
      setPending(false);
      return;
    }
    await finish();
  }

  async function sendEmail() {
    const to = email.trim();
    if (!EMAIL_RE.test(to)) {
      fail(t(lang, "signin.emailInvalid"));
      return;
    }
    if (mode === "create" && password.length < PASSWORD_MIN) {
      fail(t(lang, "signin.passwordShort"));
      return;
    }
    setPending(true);
    setError(null);
    rememberAdultTick();
    signInStarted("email");
    if (byCode) {
      const { sendSignInCode, codeErrorKey } = await import("@/lib/auth-client");
      const res = await sendSignInCode(to, lang);
      setPending(false);
      if (res.ok) {
        setCode("");
        setSentTo(to);
        keepSentTo(to, mode);
      } else {
        forgetAdultTick();
        trackError(res.code);
        fail(t(lang, codeErrorKey(res, "send")));
      }
      return;
    }
    const token = captchaToken ?? undefined;
    setCaptchaToken(null);
    const { sendMagicLink } = await import("@/lib/auth-client");
    const res = await sendMagicLink(to, withLang(next, lang), token);
    setPending(false);
    if (res.ok) setSentTo(to);
    else {
      forgetAdultTick();
      trackError(res.code);
      fail(t(lang, "signin.failed"));
    }
  }

  // The cookie is set and the effect above takes the viewer to `next`.
  async function finish() {
    setPassword("");
    await refreshViewer();
    if (!viewerSignedIn()) {
      forgetAdultTick();
      fail(t(lang, "signin.failed"));
      setPending(false);
    }
  }

  async function storePassword() {
    if (password.length < PASSWORD_MIN) {
      setChoosing(true);
      fail(t(lang, "signin.passwordShort"));
      return;
    }
    setPending(true);
    setError(null);
    const { savePassword, passwordSaveErrorKey } = await import("@/lib/auth-client");
    const res = await savePassword(password);
    if (!res.ok && res.code === "password_required") {
      // The code sign-in is too old to replace a password: back to the code
      // step for a fresh one.
      setChoosing(false);
      setCode("");
      setSentTo(email.trim());
      keepSentTo(email.trim(), mode);
      fail(t(lang, "signin.codeExpired"));
      setPending(false);
      return;
    }
    if (!res.ok) {
      trackError(res.code);
      setChoosing(true);
      fail(t(lang, passwordSaveErrorKey(res.code)));
      setPending(false);
      return;
    }
    await finish();
  }

  async function verifyCode() {
    if (!sentTo || code.length !== CODE_LENGTH) return;
    setPending(true);
    setError(null);
    rememberAdultTick();
    const { signInWithCode, codeErrorKey } = await import("@/lib/auth-client");
    const res = await signInWithCode(sentTo, code);
    if (!res.ok) {
      forgetAdultTick();
      trackError(res.code);
      fail(t(lang, codeErrorKey(res, "verify")));
      setPending(false);
      return;
    }
    keepSentTo(null);
    if (!byPassword) {
      await finish();
    } else if (mode === "create" && password !== "") {
      await storePassword();
    } else if (mode === "forgot" || (await needsPassword())) {
      // Forgot password, a create whose tab was reloaded, or a code sign-in
      // to an account with no password yet: choose one before going on.
      setChoosing(true);
      setPending(false);
    } else {
      await finish();
    }
  }

  async function needsPassword(): Promise<boolean> {
    const { fetchMe } = await import("@/lib/auth-client");
    try {
      return (await fetchMe()).needsPassword === true;
    } catch {
      return false;
    }
  }

  async function resendCode() {
    if (!sentTo) return;
    setPending(true);
    setError(null);
    const { sendSignInCode, codeErrorKey } = await import("@/lib/auth-client");
    const res = await sendSignInCode(sentTo, lang);
    setPending(false);
    if (res.ok) setCode("");
    else {
      trackError(res.code);
      fail(t(lang, codeErrorKey(res, "send")));
    }
  }

  function changeEmail() {
    setSentTo(null);
    keepSentTo(null);
    setCode("");
    setError(null);
  }

  function changeMode(next: SignInMode) {
    setMode(next);
    setPassword("");
    setShowPassword(false);
    setError(null);
  }

  async function dev() {
    setPending(true);
    setError(null);
    rememberAdultTick();
    signInStarted("dev");
    const { devLogin } = await import("@/lib/auth-client");
    const res = await devLogin();
    if (!res.ok) {
      forgetAdultTick();
      trackError("dev_login_failed");
      fail(t(lang, "signin.failed"), false);
      setPending(false);
      return;
    }
    // The store now has a user, and the effect above takes it to `next`.
    await refreshViewer();
    if (!viewerSignedIn()) {
      forgetAdultTick();
      fail(t(lang, "signin.failed"), false);
      setPending(false);
    }
  }

  return (
    <PageShell
      lang={lang}
      kicker={t(lang, "nav.account")}
      title={t(lang, "signin.title")}
      lead={t(lang, "signin.lead")}
      bare
    >
      <SignInPanel
        lang={lang}
        providers={config?.signIn ?? (status === "ready" || status === "error" ? NO_PROVIDERS : null)}
        pending={pending || signedIn}
        error={error}
        emailOpen={emailOpen}
        email={email}
        sentTo={sentTo}
        code={code}
        captcha={
          needsCaptcha && !pending ? (
            <Turnstile siteKey={TURNSTILE_SITE_KEY} lang={lang} onToken={setCaptchaToken} />
          ) : null
        }
        canSendEmail={canSendEmail}
        adult={adult}
        mode={mode}
        password={password}
        showPassword={showPassword}
        choosing={choosing}
        errorInForm={errorInForm}
        onAdult={setAdult}
        onMode={changeMode}
        onPassword={(v) => {
          setPassword(v);
          setError(null);
        }}
        onShowPassword={() => setShowPassword((v) => !v)}
        onSignInPassword={() => void signInPassword()}
        onSavePassword={() => void storePassword()}
        onProvider={(p) => void provider(p)}
        onToggleEmail={() => setEmailOpen((o) => !o)}
        onEmail={setEmail}
        onSendEmail={() => void sendEmail()}
        onCode={(v) => {
          setCode(v);
          setError(null);
        }}
        onVerify={() => void verifyCode()}
        onResend={() => void resendCode()}
        onChangeEmail={changeEmail}
        onDev={() => void dev()}
      />
    </PageShell>
  );
}
