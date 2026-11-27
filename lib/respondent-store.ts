import { useSyncExternalStore } from "react";
import { apiFetch } from "./api-fetch";
import { INVITE_TOKEN_PATTERN } from "./case-types";
import { dropAnswered } from "./history-store";

/**
 * What the invited person's browser keeps, website only (the mobile app
 * keeps the same in secure storage):
 *
 * - The respondent claim secret (`settle.claim.<caseId>`) of an answer given
 *   signed out, before an account was needed to answer. Nothing writes it any
 *   more; once signed in, linkStoredClaim moves the answer into the account
 *   and forgets the claim.
 * - The invite they were on when they went to sign in (`settle.invite`),
 *   so the sign-in redirect can be the token-free `/r` and the invite token
 *   never travels in a sign-in e-mail or an OAuth state. localStorage, not
 *   sessionStorage: a magic link opens in a new tab.
 */

const CLAIM_PREFIX = "settle.claim.";
const PENDING_KEY = "settle.invite";
/** A pending invite older than this is ignored (the sign-in links expire sooner). */
export const PENDING_INVITE_MS = 60 * 60 * 1000;

export function claimKey(caseId: string): string {
  return `${CLAIM_PREFIX}${caseId}`;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: nothing survives this page view.
  }
}

/** A stored claim, if it looks like one. */
export function parseClaim(raw: string | null): string | null {
  return raw && INVITE_TOKEN_PATTERN.test(raw) ? raw : null;
}

export function loadClaim(caseId: string): string | null {
  return parseClaim(readStorage(claimKey(caseId)));
}

/** Links the answer this browser gave signed out to the signed-in account
 * (POST /api/v1/cases/{id}/claim). The claim is dropped once the server has
 * answered for good: "linked", or "refused" (a wrong claim, an answer that
 * belongs to another account, a case that is gone). The rest keep it:
 * "conflict" (the account already answers for another side), "signed_out"
 * and "retry" (offline, server trouble). */
export async function linkStoredClaim(
  caseId: string,
): Promise<"none" | "linked" | "refused" | "conflict" | "signed_out" | "retry"> {
  const claim = loadClaim(caseId);
  if (!claim) return "none";
  try {
    const res = await apiFetch(`/api/v1/cases/${encodeURIComponent(caseId)}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim }),
    });
    if (res.status === 409) return "conflict";
    if (res.status === 401) return "signed_out";
    if (!res.ok && res.status !== 404 && res.status !== 410) return "retry";
    writeStorage(claimKey(caseId), null);
    if (res.ok) return "linked";
    // The row listing that answer has nothing left to link to either.
    dropAnswered(caseId);
    return "refused";
  } catch {
    return "retry";
  }
}

/** After sign-out or account deletion: no claim is left to link to the next account. */
export function forgetAllClaims(): void {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(CLAIM_PREFIX)) localStorage.removeItem(key);
  } catch {
    // Nothing to remove.
  }
}

/** Links every claim this browser still holds, for a case whose id is not
 * known any other way. True when one joined the account. */
export async function linkAllStoredClaims(): Promise<boolean> {
  const ids: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CLAIM_PREFIX)) ids.push(key.slice(CLAIM_PREFIX.length));
    }
  } catch {
    return false;
  }
  let joined = false;
  for (const id of ids) if ((await linkStoredClaim(id)) === "linked") joined = true;
  return joined;
}

// --- pending invite across sign-in ----------------------------------------------

export function rememberPendingInvite(token: string, now: number = Date.now()): void {
  if (!INVITE_TOKEN_PATTERN.test(token)) return;
  writeStorage(PENDING_KEY, JSON.stringify({ token, at: now }));
}

/** The pending invite token, or null when none, malformed or stale. */
export function parsePendingInvite(raw: string | null, now: number = Date.now()): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { token?: unknown; at?: unknown };
    if (typeof v.token !== "string" || typeof v.at !== "number") return null;
    if (!INVITE_TOKEN_PATTERN.test(v.token)) return null;
    if (now - v.at > PENDING_INVITE_MS || v.at > now + 60_000) return null;
    return v.token;
  } catch {
    return null;
  }
}

/** The pending invite, left in place. */
export function peekPendingInvite(now: number = Date.now()): string | null {
  return parsePendingInvite(readStorage(PENDING_KEY), now);
}

function subscribeNever(): () => void {
  return () => {};
}

/** The pending invite token for rendering: undefined during server
 * rendering and hydration (not known yet), then the token or null. */
export function usePendingInvite(): string | null | undefined {
  return useSyncExternalStore(subscribeNever, () => peekPendingInvite(), () => undefined);
}

/** Forgets the pending invite once its page is open (only if it is this one). */
export function clearPendingInvite(token: string): void {
  if (peekPendingInvite() === token) writeStorage(PENDING_KEY, null);
}

/** Reads and clears the pending invite. */
export function takePendingInvite(now: number = Date.now()): string | null {
  const token = parsePendingInvite(readStorage(PENDING_KEY), now);
  writeStorage(PENDING_KEY, null);
  return token;
}
