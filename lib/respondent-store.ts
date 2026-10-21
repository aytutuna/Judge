import { useSyncExternalStore } from "react";
import { INVITE_TOKEN_PATTERN } from "./case-types";

/**
 * What the invited person's browser keeps, website only (the mobile app
 * keeps the same in secure storage):
 *
 * - The respondent claim secret (`settle.claim.<caseId>`), returned once when
 *   they answer signed out. It proves they wrote side B, so a later signed-in
 *   "add context" from this browser is accepted, and nobody else holding the
 *   link can act as them.
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

const memory = new Map<string, string>();
const listeners = new Set<() => void>();

/** A stored claim, if it looks like one. */
export function parseClaim(raw: string | null): string | null {
  return raw && INVITE_TOKEN_PATTERN.test(raw) ? raw : null;
}

export function loadClaim(caseId: string): string | null {
  return parseClaim(readStorage(claimKey(caseId)) ?? memory.get(caseId) ?? null);
}

export function saveClaim(caseId: string, claim: string | null | undefined): void {
  const value = parseClaim(claim ?? null);
  if (!value) return;
  memory.set(caseId, value);
  writeStorage(claimKey(caseId), value);
  for (const fn of listeners) fn();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(CLAIM_PREFIX)) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** This browser's claim for a case. Null during server rendering and the
 * first client render, so hydration always matches. */
export function useClaim(caseId: string | null): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (caseId ? loadClaim(caseId) : null),
    () => null,
  );
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
