"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { signInStarted, trackError } from "@/lib/analytics/client";
import type { AuthProviders } from "@/lib/account-types";
import { t, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { refreshViewer, useViewer, viewerSignedIn } from "@/lib/use-viewer";
import { lastSignIn, startSignIn, type SignInMethodUsed } from "@/lib/last-signin";
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
  email: string;
  /** The email was accepted and its password step is showing. */
  emailStep: boolean;
  sentTo: string | null;
  /** The emailed code being typed (email code sign-in, after `sentTo`). */
  code: string;
  captcha: React.ReactNode;
  canSendEmail: boolean;
  /** The Turnstile token a code request needs is there (always, without the widget). */
  hasToken: boolean;
  /** A code is wanted and only the Turnstile check is missing. */
  waiting: boolean;
  mode: SignInMode;
  password: string;
  showPassword: boolean;
  /** Signed in by code and still choosing a password. */
  choosing: boolean;
  /** `error` belongs to the email area's fields, not the top of the card. */
  errorInForm: boolean;
  /** Seconds until another code may be asked for. */
  resendIn: number;
  lastUsed: SignInMethodUsed | null;
  onPassword: (value: string) => void;
  onShowPassword: () => void;
  onSignInPassword: () => void;
  onSavePassword: () => void;
  onSkip: () => void;
  onProvider: (p: "apple" | "google") => void;
  onEmail: (value: string) => void;
  onContinue: () => void;
  onSendEmail: () => void;
  onForgot: () => void;
  onUseCode: () => void;
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
  email,
  emailStep,
  sentTo,
  code,
  captcha,
  canSendEmail,
  hasToken,
  waiting,
  mode,
  password,
  showPassword,
  choosing,
  errorInForm,
  resendIn,
  lastUsed,
  onPassword,
  onShowPassword,
  onSignInPassword,
  onSavePassword,
  onSkip,
  onProvider,
  onEmail,
  onContinue,
  onSendEmail,
  onForgot,
  onUseCode,
  onCode,
  onVerify,
  onResend,
  onChangeEmail,
  onDev,
}: SignInPanelProps) {
  const formId = useId();
  const loading = providers === null;
  const byCode = providers?.emailCode === true;
  const byPassword = byCode && providers?.password === true;
  const codeStep = Boolean(providers?.email && byCode && sentTo);
  const none = providers !== null && !providers.apple && !providers.google && !providers.email && !providers.dev;
  const lastUsedTag = <span className={styles.tag}>{t(lang, "signin.lastUsed")}</span>;

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
        {available && lastUsed === p ? <span className={`${styles.tag} ${styles.tagOnBtn}`}>{t(lang, "signin.lastUsed")}</span> : null}
      </button>
    );
  };

  const formError =
    errorInForm && error ? (
      <p id={`${formId}-error`} className={styles.error} role="alert">
        {error}
      </p>
    ) : null;

  const passwordField = (kind: "current" | "new") => {
    const id = `${formId}-${kind === "new" ? "newpw" : "pw"}`;
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
          autoFocus
          required
          maxLength={128}
          aria-invalid={formError ? true : undefined}
          aria-describedby={formError ? `${formId}-error` : undefined}
          value={password}
          onChange={(e) => onPassword(e.target.value)}
        />
        <button type="button" className={styles.textBtn} aria-pressed={showPassword} onClick={onShowPassword}>
          {t(lang, "signin.passwordShow")}
        </button>
      </>
    );
  };

  // Lets a password manager tie the password to the address.
  const usernameField = (
    <input type="email" autoComplete="username" className="sr-only" tabIndex={-1} aria-hidden readOnly value={email || sentTo || ""} />
  );

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
          {usernameField}
          {passwordField("new")}
          {formError}
          <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={password === "" || pending}>
            {t(lang, "signin.passwordSave")}
          </button>
          <button type="button" className={styles.textBtn} disabled={pending} onClick={onSkip}>
            {t(lang, "signin.skip")}
          </button>
        </form>
      </div>
    );
  }

  const passwordStep = (
    <form
      className={styles.field}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || password === "") return;
        if (mode === "create") onSendEmail();
        else onSignInPassword();
      }}
    >
      <div className={styles.who}>
        <span className={styles.whoEmail}>{email}</span>
        <button type="button" className={styles.textBtn} disabled={pending} onClick={onChangeEmail}>
          {t(lang, "signin.changeEmail")}
        </button>
      </div>
      {usernameField}
      {passwordField(mode === "create" ? "new" : "current")}
      {formError}
      {captcha}
      <button
        type="submit"
        className={`${styles.btn} ${styles.secondary}`}
        disabled={pending || password === "" || (mode === "create" && !hasToken)}
      >
        {t(lang, mode === "create" ? "signin.continue" : "signin.passwordSubmit")}
      </button>
      {mode === "password" ? (
        <>
          <button type="button" className={styles.textBtn} disabled={pending || !hasToken} onClick={onForgot}>
            {t(lang, "signin.forgot")}
          </button>
          <button type="button" className={styles.textBtn} disabled={pending || !hasToken} onClick={onUseCode}>
            {t(lang, "signin.useCode")}
          </button>
        </>
      ) : null}
    </form>
  );

  const codeForm = (
    <>
      <p id={`${formId}-sent`} className={styles.ok} role="status">
        {t(lang, "signin.codeSent", { email: sentTo ?? "" })}
      </p>
      <form
        className={styles.field}
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === CODE_LENGTH && !pending) onVerify();
        }}
      >
        <label className={styles.label} htmlFor={`${formId}-code`}>
          {t(lang, "signin.codeLabel")}
        </label>
        <input
          id={`${formId}-code`}
          className={`${styles.input} ${styles.codeInput}`}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          autoFocus
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={`${formId}-sent${error ? ` ${formId}-error` : ""}`}
          value={code}
          onChange={(e) => onCode(digitsOnly(e.target.value))}
        />
        {error ? (
          <p id={`${formId}-error`} className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={code.length !== CODE_LENGTH || pending}>
          {t(lang, "signin.codeSubmit")}
        </button>
      </form>
      {captcha}
      <button type="button" className={styles.textBtn} disabled={pending || resendIn > 0 || !hasToken} onClick={onResend}>
        {resendIn > 0 ? t(lang, "signin.codeResendIn", { n: resendIn }) : t(lang, "signin.codeResend")}
      </button>
      <button type="button" className={styles.textBtn} disabled={pending} onClick={onChangeEmail}>
        {t(lang, "signin.changeEmail")}
      </button>
    </>
  );

  const emailForm = (
    <form
      className={styles.field}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSendEmail && !pending) onContinue();
      }}
    >
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={`${formId}-email`}>
          {t(lang, "signin.emailLabel")}
        </label>
        {lastUsed === "email" ? lastUsedTag : null}
      </div>
      <input
        id={`${formId}-email`}
        className={styles.input}
        type="email"
        inputMode="email"
        autoComplete="username"
        required
        value={email}
        placeholder={t(lang, "signin.emailPlaceholder")}
        disabled={pending}
        aria-invalid={formError ? true : undefined}
        aria-describedby={formError ? `${formId}-error` : undefined}
        onChange={(e) => onEmail(e.target.value)}
      />
      {captcha}
      {waiting ? <p className={styles.small}>{t(lang, "turnstile.label")}</p> : null}
      {formError}
      <button type="submit" className={`${styles.btn} ${styles.secondary}`} disabled={!canSendEmail || pending}>
        {t(lang, "signin.continue")}
      </button>
    </form>
  );

  const choose = !codeStep && !(emailStep && byPassword) && !sentTo;

  return (
    <div className={styles.card}>
      <p className={loading ? styles.muted : "sr-only"} role="status" aria-live="polite">
        {loading ? t(lang, "signin.loading") : ""}
      </p>
      {none ? <p className={styles.notice}>{t(lang, "signin.unavailable")}</p> : null}
      {error && !errorInForm && !codeStep ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {choose ? (
        <>
          {providerButton("apple")}
          {providerButton("google")}
          {providers?.email ? (
            <>
              <div className={styles.or} aria-hidden>
                {t(lang, "signin.or")}
              </div>
              {emailForm}
            </>
          ) : null}
          {providers?.dev ? (
            <div className={styles.devBox}>
              <button type="button" className={`${styles.btn} ${styles.secondary}`} disabled={pending} onClick={onDev}>
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
        </>
      ) : codeStep ? (
        codeForm
      ) : (
        passwordStep
      )}
    </div>
  );
}

const RESEND_SECONDS = 30;

/** /signin: Apple and Google first, then email (the server says whether it
 * takes a password or a code), the dev test login only where the server
 * reports it. Signed-in visitors go to /account. `next` is the raw ?next=
 * value, `failed` is set when Apple or Google sent the visitor back with an
 * error. */
export function SignInView({ next: rawNext, failed }: { next?: string | string[]; failed?: boolean }) {
  const lang = useLang();
  const router = useRouter();
  const { me, config, status } = useViewer();
  const next = safeNext(rawNext);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [emailStep, setEmailStep] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [awaitToken, setAwaitToken] = useState(false);
  const [mode, setMode] = useState<SignInMode>("password");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [errorInForm, setErrorInForm] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [lastUsed, setLastUsed] = useState<SignInMethodUsed | null>(null);

  const signedIn = Boolean(me?.user);
  // A mobile browser can reload the tab while the user reads the mail.
  useEffect(() => {
    const kept = readSentTo();
    const last = lastSignIn();
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of browser storage */
    if (kept) {
      setSentTo(kept.email);
      setEmail(kept.email);
      setMode(kept.mode);
    } else if (last) {
      setEmail(last.email);
    }
    if (last) setLastUsed(last.method);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => {
    if (!failed) return;
    /* eslint-disable react-hooks/set-state-in-effect -- the provider redirected back with an error */
    setError(t(lang, "signin.failed"));
    setErrorInForm(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [failed, lang]);
  useEffect(() => {
    if (signedIn) router.replace(next);
  }, [signedIn, next, router]);
  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const byCode = config?.signIn.emailCode === true;
  const byPassword = byCode && config?.signIn.password === true;
  // Every code request carries a Turnstile token; the widget is shown on
  // each screen that can send one.
  const needsCaptcha = TURNSTILE_SITE_KEY !== "" && byCode;
  const hasToken = !needsCaptcha || captchaToken !== null;
  // A password account signs in without the widget; a code needs its token,
  // which is waited for once the address turns out to take one.
  const canSendEmail = EMAIL_RE.test(email.trim()) && (byPassword || hasToken);

  // Back from Apple or Google through the browser's page cache: the page
  // comes back exactly as it was left, spinner included.
  useEffect(() => {
    function restored(e: PageTransitionEvent) {
      if (!e.persisted) return;
      setPending(false);
      setError(null);
    }
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);

  function fail(message: string, inForm = true) {
    setError(message);
    setErrorInForm(inForm);
  }

  // A chunk that fails to load (offline, a deploy in between) must not leave
  // the form spinning.
  async function loadClient() {
    try {
      return await import("@/lib/auth-client");
    } catch {
      fail(t(lang, "signin.failed"));
      setPending(false);
      return null;
    }
  }

  async function provider(p: "apple" | "google") {
    setAwaitToken(false);
    setPending(true);
    setError(null);
    startSignIn(p);
    signInStarted(p);
    const client = await loadClient();
    if (!client) return;
    const res = await client.signInWithProvider(p, next, `/signin?next=${encodeURIComponent(next)}`);
    // Success leaves the page for Apple or Google; only failure lands here.
    if (!res.ok) {
      trackError(res.code);
      fail(t(lang, "signin.failed"), false);
      setPending(false);
    }
  }

  async function signInPassword() {
    const to = email.trim();
    setPending(true);
    setError(null);
    startSignIn("email", to);
    signInStarted("password");
    const client = await loadClient();
    if (!client) return;
    const res = await client.signInWithPassword(to, password);
    if (!res.ok) {
      trackError(res.code);
      fail(t(lang, client.passwordSignInErrorKey(res)));
      setPending(false);
      return;
    }
    await finish();
  }

  // Which way the address signs in decides the next screen: a password for
  // an account that has one, the emailed code for an account that has none,
  // and a new password plus the code for an address with no account.
  async function continueWithEmail() {
    const to = email.trim();
    if (!EMAIL_RE.test(to)) {
      fail(t(lang, "signin.emailInvalid"));
      return;
    }
    if (!byPassword) {
      await sendEmail("code");
      return;
    }
    setPending(true);
    setError(null);
    const client = await loadClient();
    if (!client) return;
    const res = await client.lookupEmail(to);
    // A refused or failed lookup is not a dead end: the password screen
    // still offers the code.
    const method = res.ok ? res.method : "password";
    if (!res.ok) trackError(res.code);
    if (method === "code") {
      if (hasToken) {
        await sendEmail("code");
      } else {
        // The widget is back as soon as pending clears; the code goes out
        // when its token arrives.
        setPending(false);
        setAwaitToken(true);
      }
      return;
    }
    setPending(false);
    changeMode(method === "password" ? "password" : "create");
    setEmailStep(true);
  }

  useEffect(() => {
    if (!awaitToken || captchaToken === null) return;
    void sendEmail("code");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the token arrives
  }, [awaitToken, captchaToken]);

  async function sendEmail(sendMode: SignInMode) {
    const to = email.trim();
    if (!EMAIL_RE.test(to)) {
      fail(t(lang, "signin.emailInvalid"));
      return;
    }
    if (sendMode === "create" && password.length < PASSWORD_MIN) {
      fail(t(lang, "signin.passwordShort"));
      return;
    }
    setAwaitToken(false);
    setPending(true);
    setError(null);
    startSignIn("email", to);
    signInStarted("email");
    const client = await loadClient();
    if (!client) return;
    const token = captchaToken ?? undefined;
    setCaptchaToken(null);
    const res = await client.sendSignInCode(to, lang, token);
    setPending(false);
    if (res.ok) {
      setCode("");
      setMode(sendMode);
      if (sendMode !== "create") setPassword("");
      setSentTo(to);
      setResendIn(RESEND_SECONDS);
      keepSentTo(to, sendMode);
    } else {
      trackError(res.code);
      fail(t(lang, client.codeErrorKey(res, "send")));
    }
  }

  // The cookie is set and the effect above takes the viewer to `next`.
  async function finish() {
    setPassword("");
    await refreshViewer();
    if (!viewerSignedIn()) {
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
    const client = await loadClient();
    if (!client) return;
    const res = await client.savePassword(password);
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
      fail(t(lang, client.passwordSaveErrorKey(res.code)));
      setPending(false);
      return;
    }
    await finish();
  }

  async function skipPassword() {
    setPending(true);
    await finish();
  }

  async function verifyCode(entered: string) {
    if (!sentTo || entered.length !== CODE_LENGTH) return;
    setPending(true);
    setError(null);
    startSignIn("email", sentTo);
    const client = await loadClient();
    if (!client) return;
    const res = await client.signInWithCode(sentTo, entered);
    if (!res.ok) {
      trackError(res.code);
      fail(t(lang, client.codeErrorKey(res, "verify")));
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
    try {
      const { fetchMe } = await import("@/lib/auth-client");
      return (await fetchMe()).needsPassword === true;
    } catch {
      return false;
    }
  }

  async function resendCode() {
    if (!sentTo || resendIn > 0) return;
    setPending(true);
    setError(null);
    const client = await loadClient();
    if (!client) return;
    const token = captchaToken ?? undefined;
    setCaptchaToken(null);
    const res = await client.sendSignInCode(sentTo, lang, token);
    setPending(false);
    if (res.ok) {
      setCode("");
      setResendIn(RESEND_SECONDS);
    } else {
      trackError(res.code);
      fail(t(lang, client.codeErrorKey(res, "send")));
    }
  }

  function changeEmail() {
    setAwaitToken(false);
    setSentTo(null);
    keepSentTo(null);
    setEmailStep(false);
    changeMode("password");
    setCode("");
    setResendIn(0);
  }

  function changeMode(to: SignInMode) {
    setMode(to);
    setPassword("");
    setShowPassword(false);
    setError(null);
  }

  async function dev() {
    setAwaitToken(false);
    setPending(true);
    setError(null);
    signInStarted("dev");
    const client = await loadClient();
    if (!client) return;
    const res = await client.devLogin();
    if (!res.ok) {
      trackError("dev_login_failed");
      fail(t(lang, "signin.failed"), false);
      setPending(false);
      return;
    }
    // The store now has a user, and the effect above takes it to `next`.
    await refreshViewer();
    if (!viewerSignedIn()) {
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
        email={email}
        emailStep={emailStep}
        sentTo={sentTo}
        code={code}
        captcha={
          needsCaptcha && !pending ? (
            <Turnstile siteKey={TURNSTILE_SITE_KEY} lang={lang} onToken={setCaptchaToken} />
          ) : null
        }
        canSendEmail={canSendEmail}
        hasToken={hasToken}
        waiting={awaitToken}
        mode={mode}
        password={password}
        showPassword={showPassword}
        choosing={choosing}
        errorInForm={errorInForm}
        resendIn={resendIn}
        lastUsed={lastUsed}
        onPassword={(v) => {
          setPassword(v);
          setError(null);
        }}
        onShowPassword={() => setShowPassword((v) => !v)}
        onSignInPassword={() => void signInPassword()}
        onSavePassword={() => void storePassword()}
        onSkip={() => void skipPassword()}
        onProvider={(p) => void provider(p)}
        onEmail={(v) => {
          setEmail(v);
          setAwaitToken(false);
          setError(null);
        }}
        onContinue={() => void continueWithEmail()}
        onSendEmail={() => void sendEmail("create")}
        onForgot={() => void sendEmail("forgot")}
        onUseCode={() => void sendEmail("code")}
        onCode={(v) => {
          // Six digits typed or pasted submit themselves, once.
          const complete = v.length === CODE_LENGTH && code.length < CODE_LENGTH;
          setCode(v);
          setError(null);
          if (complete && !pending) void verifyCode(v);
        }}
        onVerify={() => void verifyCode(code)}
        onResend={() => void resendCode()}
        onChangeEmail={changeEmail}
        onDev={() => void dev()}
      />
    </PageShell>
  );
}
