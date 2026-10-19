/**
 * Browser-side sign-in and account calls for the website. No Next imports:
 * every call is plain HTTP against /api/auth/* (Better Auth) and /api/v1/*,
 * the same endpoints the mobile app uses (with a bearer token instead of the
 * cookie).
 */

import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";
import { isApiErrorCode, type ApiErrorCode } from "./api-errors";
import type { AppConfig, MeResponse } from "./account-types";

// No baseURL: the browser's own origin, so one build works on any domain.
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [magicLinkClient()],
});

type Outcome = { ok: true } | { ok: false; code: string };

function failure(error: { code?: string; status?: number } | null | undefined): Outcome {
  return { ok: false, code: error?.code || (error?.status ? `http_${error.status}` : "failed") };
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
