/**
 * Browser-side sign-in and account calls for the website. No Next imports:
 * every call is plain HTTP against /api/auth/* (Better Auth) and /api/v1/*,
 * the same endpoints the mobile app uses (with a bearer token instead of the
 * cookie).
 */

import { createAuthClient } from "better-auth/react";
import { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";
import { isApiErrorCode, type ApiErrorCode } from "./api-errors";
import type { AgeState, AppConfig, MeResponse } from "./account-types";
import type { Key } from "./i18n";

// No baseURL: the browser's own origin, so one build works on any domain.
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [magicLinkClient(), emailOTPClient()],
});

type Failed = { ok: false; code: string; status?: number };
type Outcome = { ok: true } | Failed;

function failure(error: { code?: string; status?: number } | null | undefined): Outcome {
  const status = error?.status || undefined;
  return { ok: false, code: error?.code || (status ? `http_${status}` : "failed"), status };
}

/** Starts the Apple or Google redirect flow; on success the browser leaves
 * the page, so the resolved value only matters on failure. */
export async function signInWithProvider(
  provider: "apple" | "google",
  callbackURL: string,
): Promise<Outcome> {
  try {
    const { error } = await authClient.signIn.social({ provider, callbackURL });
    return error ? failure(error) : { ok: true };
  } catch {
    return { ok: false, code: "network" };
  }
}

/** Emails a sign-in link. `captchaToken` is the Turnstile token when the
 * widget is configured. Put `?lang=tr` on callbackURL for a Turkish email. */
export async function sendMagicLink(
  email: string,
  callbackURL: string,
  captchaToken?: string,
): Promise<Outcome> {
  try {
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL,
      fetchOptions: captchaToken ? { headers: { "x-captcha-response": captchaToken } } : undefined,
    });
    return error ? failure(error) : { ok: true };
  } catch {
    return { ok: false, code: "network" };
  }
}

/** Emails a 6-digit sign-in code (the apps use the same endpoint). `lang`
 * picks the language of the email. */
export async function sendSignInCode(email: string, lang: string): Promise<Outcome> {
  try {
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
      fetchOptions: { query: { lang } },
    });
    return error ? failure(error) : { ok: true };
  } catch {
    return { ok: false, code: "network" };
  }
}

/** Signs in with the emailed code; success sets the session cookie. */
export async function signInWithCode(email: string, otp: string): Promise<Outcome> {
  try {
    const { error } = await authClient.signIn.emailOtp({ email, otp });
    return error ? failure(error) : { ok: true };
  } catch {
    return { ok: false, code: "network" };
  }
}

/** Signs in with email and password; success sets the session cookie. */
export async function signInWithPassword(email: string, password: string): Promise<Outcome> {
  try {
    const { error } = await authClient.signIn.email({ email, password });
    return error ? failure(error) : { ok: true };
  } catch {
    return { ok: false, code: "network" };
  }
}

/** POST /api/v1/me/password: sets the password, or replaces it (`current` is
 * the old one, which is not needed right after a code sign-in). */
export async function savePassword(
  password: string,
  current?: string,
): Promise<{ ok: true } | { ok: false; code: ApiErrorCode | "network" }> {
  let res: Response;
  try {
    res = await fetch("/api/v1/me/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(current === undefined ? { password } : { password, current }),
    });
  } catch {
    return { ok: false, code: "network" };
  }
  if (res.ok) return { ok: true };
  const body: unknown = await res.json().catch(() => null);
  const code = typeof body === "object" && body !== null ? (body as { code?: unknown }).code : null;
  return { ok: false, code: isApiErrorCode(code) ? code : "unavailable" };
}

/** The message for a failed password sign-in. */
export function passwordSignInErrorKey(res: { code: string; status?: number }): Key {
  const { code, status } = res;
  if (code === "network") return "signin.offline";
  if (status === 401) return "signin.passwordWrong";
  if (status === 429) return "signin.rateLimited";
  if (status === 404 || (status !== undefined && status >= 500)) return "signin.serviceDown";
  return "signin.failed";
}

/** The message for a failed password save, from the route's error code. */
export function passwordSaveErrorKey(code: ApiErrorCode | "network"): Key {
  if (code === "network") return "signin.offline";
  if (code === "too_short" || code === "too_long") return "signin.passwordShort";
  if (code === "password_wrong") return "error.password_wrong";
  if (code === "password_required") return "error.password_required";
  if (code === "rate_limited") return "signin.rateLimited";
  return "signin.passwordSaveFailed";
}

/** The message for a failed code call. Same mapping as the apps: the status
 * decides first (the server's reply also carries a `code` such as
 * INVALID_EMAIL or unavailable), the code tells the verify errors apart. */
export function codeErrorKey(res: { code: string; status?: number }, step: "send" | "verify"): Key {
  const { code, status } = res;
  if (code === "network") return "signin.offline";
  if (status === 429) return "signin.rateLimited";
  if (status === 404 || (status !== undefined && status >= 500)) return "signin.serviceDown";
  if (step === "send") return status === 400 ? "signin.emailInvalid" : "signin.failed";
  if (code === "INVALID_OTP" || status === 400) return "signin.codeInvalid";
  if (code === "OTP_EXPIRED") return "signin.codeExpired";
  if (code === "TOO_MANY_ATTEMPTS") return "signin.codeTooMany";
  return "signin.failed";
}

/** Local test sign-in (only answers under `next dev` with DEV_LOGIN=1 on
 * localhost); sets the session cookie. */
export async function devLogin(email?: string): Promise<{ ok: boolean }> {
  try {
    const res = await fetch("/api/v1/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(email ? { email } : {}),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

export async function signOut(): Promise<void> {
  try {
    await authClient.signOut();
  } catch {
    // Already signed out, or offline: the next /me call shows the truth.
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) throw new Error(`${path} answered HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** GET /api/v1/me. Throws on network or server errors. */
export function fetchMe(): Promise<MeResponse> {
  return getJson<MeResponse>("/api/v1/me");
}

/** GET /api/v1/config. Throws on network or server errors. */
export function fetchConfig(): Promise<AppConfig> {
  return getJson<AppConfig>("/api/v1/config");
}

/** POST /api/v1/me/age after the "I'm 18 or older" box was ticked. Null on
 * any failure. */
export async function confirmAdult(): Promise<AgeState | null> {
  try {
    const res = await fetch("/api/v1/me/age", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ adult: true, source: "checkbox" }),
    });
    return res.ok ? ((await res.json()) as AgeState) : null;
  } catch {
    return null;
  }
}

/** DELETE /api/v1/me: removes the account, its sign-ins and entitlements. */
export async function deleteAccount(): Promise<
  { ok: true } | { ok: false; code: ApiErrorCode | "network" }
> {
  let res: Response;
  try {
    res = await fetch("/api/v1/me", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ confirm: "delete" }),
    });
  } catch {
    return { ok: false, code: "network" };
  }
  if (res.ok) return { ok: true };
  const body: unknown = await res.json().catch(() => null);
  const code = typeof body === "object" && body !== null ? (body as { code?: unknown }).code : null;
  return { ok: false, code: isApiErrorCode(code) ? code : "unavailable" };
}
