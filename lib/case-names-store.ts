import { useSyncExternalStore } from "react";
import type { PartyLetter } from "./case-types";
import { mergeNameMaps } from "./originals-types";
import type { NameMapping } from "./types";

export { mergeNameMaps };

/**
 * The real names behind a case's labels, as this browser received them.
 * The server keeps each party's map encrypted and sends it back in
 * `case.names` on any device; this store is the fallback for cases created
 * before that (or on a server without an originals key). Each submission's
 * `name_map` is saved here under `settle.names.<caseId>.<a|b>`, merged across
 * the same person's submissions (their side, then their appeal).
 * Website-only (localStorage); the mobile app keeps the same data in secure
 * storage.
 */

const PREFIX = "settle.names.";
const EMPTY: NameMapping[] = [];

export function namesKey(caseId: string, party: PartyLetter): string {
  return `${PREFIX}${caseId}.${party}`;
}

/** Parses a stored value; anything unexpected reads as empty. */
export function parseStoredNames(raw: string | null): NameMapping[] {
  if (!raw) return EMPTY;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? mergeNameMaps([], v as NameMapping[]) : EMPTY;
  } catch {
    return EMPTY;
  }
}

// --- store ------------------------------------------------------------------

const cache = new Map<string, { raw: string | null; value: NameMapping[] }>();
const listeners = new Set<() => void>();

function read(key: string): NameMapping[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return cache.get(key)?.value ?? EMPTY;
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value;
  const value = parseStoredNames(raw);
  cache.set(key, { raw, value });
  return value;
}

export function loadCaseNames(caseId: string, party: PartyLetter): NameMapping[] {
  return read(namesKey(caseId, party));
}

/** Merges a submission's name map into what this browser already holds. */
export function saveCaseNames(caseId: string, party: PartyLetter, map: readonly NameMapping[]): void {
  if (map.length === 0) return;
  const key = namesKey(caseId, party);
  const merged = mergeNameMaps(read(key), map);
  const raw = JSON.stringify(merged);
  cache.set(key, { raw, value: merged });
  try {
    localStorage.setItem(key, raw);
  } catch {
    // Storage unavailable: names last for this page view only.
  }
  for (const fn of listeners) fn();
}

/** After a case is deleted: its names go too. */
export function forgetCaseNames(caseId: string): void {
  for (const party of ["a", "b"] as const) {
    const key = namesKey(caseId, party);
    cache.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to remove.
    }
  }
  for (const fn of listeners) fn();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(PREFIX)) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** This browser's names for one party of a case. Empty during server
 * rendering and the first client render, so hydration always matches. */
export function useCaseNames(caseId: string | null, party: PartyLetter): NameMapping[] {
  return useSyncExternalStore(
    subscribe,
    () => (caseId ? loadCaseNames(caseId, party) : EMPTY),
    () => EMPTY,
  );
}
