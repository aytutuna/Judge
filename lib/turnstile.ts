/**
 * Cloudflare Turnstile server-side verification. The browser widget yields a
 * single-use token; only this check (with the secret key) proves it is real.
 */

import { signal } from "./signals";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Cloudflare's documented maximum token length. */
const MAX_TOKEN_LENGTH = 2048;
const VERIFY_TIMEOUT_MS = 5_000;

/** Verification runs only when TURNSTILE_SECRET_KEY is set (skipped in
 * local dev). */
export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

/** "invalid": missing, malformed, expired, or reused token. "error": the
 * check itself could not run (network, timeout, Cloudflare outage). */
export type TurnstileResult = "ok" | "invalid" | "error";

export async function verifyTurnstile(
  token: string | undefined,
  ip: string,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return "ok";
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    signal("turnstile_fail");
    return "invalid";
  }

  const form = new URLSearchParams({ secret, response: token });
  if (ip !== "unknown") form.set("remoteip", ip);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[turnstile] siteverify HTTP", res.status);
      return "error";
    }
    const data = (await res.json()) as { success?: unknown; "error-codes"?: unknown };
    if (data.success === true) return "ok";
    const codes = Array.isArray(data["error-codes"]) ? data["error-codes"] : [];
    // Bad configuration is our fault, not the visitor's: surface it as an
    // outage so the logs show it and the visitor is not told they failed.
    if (codes.includes("missing-input-secret") || codes.includes("invalid-input-secret")) {
      console.error("[turnstile] secret key rejected:", codes.join(", "));
      return "error";
    }
    signal("turnstile_fail");
    return "invalid";
  } catch (e) {
    console.error("[turnstile] siteverify failed:", e instanceof Error ? e.message : String(e));
    return "error";
  }
}
