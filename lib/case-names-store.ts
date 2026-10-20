import { useSyncExternalStore } from "react";
import type { PartyLetter } from "./case-types";
import type { NameMapping } from "./types";

/**
 * The real names behind a case's labels, kept only in this browser. The
 * server never stores them: each submission's `name_map` comes back once in
 * its response and is saved here under `settle.names.<caseId>.<a|b>`,
 * merged across the same person's submissions (their side, then their
 * appeal). Each party's own view reads its own map, so names show only on
 * the device that submitted them. Website-only (localStorage); the mobile
 * app keeps the same data in secure storage.
 */

const PREFIX = "settle.names.";
const EMPTY: NameMapping[] = [];
/** A generous guard against a corrupted or hostile storage entry. */
const MAX_ENTRIES = 60;

export function namesKey(caseId: string, party: PartyLetter): string {
  return `${PREFIX}${caseId}.${party}`;
}

function isMapping(v: unknown): v is NameMapping {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return typeof m.original === "string" && typeof m.replacement === "string" && m.original.length > 0;
}

/** Earlier entries first, then new ones; exact duplicates dropped. */
export function mergeNameMaps(prev: readonly NameMapping[], next: readonly NameMapping[]): NameMapping[] {
  const seen = new Set<string>();
  const out: NameMapping[] = [];
  for (const m of [...prev, ...next]) {
    if (!isMapping(m)) continue;
    const key = `${m.original}\u0000${m.replacement}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ original: m.original, replacement: m.replacement });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
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
