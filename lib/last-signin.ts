/**
 * The sign-in method and email last used on this browser, for the sign-in
 * page's "Last used" tag and its prefilled email. An attempt is only written
 * as pending: Apple and Google leave the page, so the success is seen by the
 * viewer store, which commits it once a user is signed in.
 */

export type SignInMethodUsed = "apple" | "google" | "email";

const PENDING_KEY = "judge.signinPending";
const LAST_KEY = "judge.lastSignin";

export type LastSignIn = { method: SignInMethodUsed; email: string };

const METHODS: readonly string[] = ["apple", "google", "email"];

function parse(raw: string | null): { method: SignInMethodUsed; email?: string } | null {
  try {
    const v = raw ? (JSON.parse(raw) as { method?: unknown; email?: unknown }) : null;
    if (!v || typeof v.method !== "string" || !METHODS.includes(v.method)) return null;
    return { method: v.method as SignInMethodUsed, email: typeof v.email === "string" ? v.email : undefined };
  } catch {
    return null;
  }
}

/** Notes a sign-in about to be tried; `email` is for the email method. */
export function startSignIn(method: SignInMethodUsed, email?: string): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ method, email }));
  } catch {
    // Storage blocked: nothing is remembered.
  }
}

/** Called when a user is signed in: the pending attempt becomes the last one.
 * Apple and Google give no email of their own, so the account's is kept. */
export function commitSignIn(accountEmail: string): void {
  try {
    const pending = parse(localStorage.getItem(PENDING_KEY));
    if (!pending) return;
    localStorage.removeItem(PENDING_KEY);
    localStorage.setItem(LAST_KEY, JSON.stringify({ method: pending.method, email: pending.email ?? accountEmail }));
  } catch {
    // Storage blocked: nothing is remembered.
  }
}

export function lastSignIn(): LastSignIn | null {
  try {
    const v = parse(localStorage.getItem(LAST_KEY));
    return v?.email ? { method: v.method, email: v.email } : null;
  } catch {
    return null;
  }
}

/** After sign-out or account deletion: the address is not offered again. */
export function forgetLastSignIn(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
    localStorage.removeItem(LAST_KEY);
  } catch {
    // Nothing to remove.
  }
}
