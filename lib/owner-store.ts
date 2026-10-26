import { useSyncExternalStore } from "react";
import { OWNER_TOKEN_PATTERN, ownerTokenKey } from "./originals-types";

/**
 * The owner tokens of verdicts written signed out, kept only in this
 * browser under `judge.owner.<verdictId>`. The token is the writer's key to
 * their own verdict (original text, names, removal); it is sent only as the
 * X-Owner-Token header, never in a URL. Website-only (localStorage); the
 * mobile app keeps the same values in secure storage.
 */

const OWNER_PREFIX = ownerTokenKey("");
const listeners = new Set<() => void>();

export function loadOwnerToken(verdictId: string): string | null {
  try {
    const raw = localStorage.getItem(ownerTokenKey(verdictId));
    return raw && OWNER_TOKEN_PATTERN.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveOwnerToken(verdictId: string, token: string | null | undefined): void {
  if (!token || !OWNER_TOKEN_PATTERN.test(token)) return;
  try {
    localStorage.setItem(ownerTokenKey(verdictId), token);
  } catch {
    // Storage unavailable: the token lasts for this page view only.
  }
  for (const fn of listeners) fn();
}

/** Every verdict this browser holds a token for. */
export function ownerTokenIds(): string[] {
  const ids: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(OWNER_PREFIX)) ids.push(key.slice(OWNER_PREFIX.length));
    }
  } catch {
    // Storage unavailable: no tokens either.
  }
  return ids;
}

/** After a removal: the token has nothing left to open. */
export function forgetOwnerToken(verdictId: string): void {
  try {
    localStorage.removeItem(ownerTokenKey(verdictId));
  } catch {
    // Nothing to remove.
  }
  for (const fn of listeners) fn();
}

/** Headers for a writer's request: the token when this browser has one
 * (otherwise the session cookie is the credential). */
export function ownerHeaders(token: string | null): Record<string, string> {
  return token ? { "X-Owner-Token": token } : {};
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith("judge.owner.")) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** This browser's token for a verdict: undefined while server rendering and
 * on the first client render (so hydration matches), then the token or null. */
export function useOwnerToken(verdictId: string | null): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (verdictId ? loadOwnerToken(verdictId) : null),
    () => undefined,
  );
}
