import { useSyncExternalStore } from "react";

/**
 * This browser's own list of the verdicts it wrote signed out, newest first,
 * under `judge.history`. The verdicts themselves live on the server; this is
 * only an index so My verdicts can list them without an account. The
 * headline is kept with the writer's names put back, as they saw it.
 * Website-only (localStorage).
 */

export const HISTORY_KEY = "judge.history";
export const HISTORY_MAX = 50;
/** Verdicts written before the index existed, still to be looked up. */
export const SEED_KEY = "judge.history.seed";
/** When a tab last started on that queue (ms). */
export const SEED_TURN_KEY = "judge.history.seedTurn";

export type HistoryEntry = {
  id: string;
  createdAt: string;
  headline: string | null;
  /** Set when the writer removed the verdict from this browser. */
  removed?: true;
  /** Indexed while it was still being judged; looked up again later. */
  pending?: true;
};

const EMPTY: HistoryEntry[] = [];

function isEntry(v: unknown): v is HistoryEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    e.id.length > 0 &&
    typeof e.createdAt === "string" &&
    !Number.isNaN(Date.parse(e.createdAt)) &&
    (e.headline === null || typeof e.headline === "string")
  );
}

/** Parses a stored value; malformed entries are dropped, anything else reads as empty. */
export function parseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return EMPTY;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(isEntry).slice(0, HISTORY_MAX) : EMPTY;
  } catch {
    return EMPTY;
  }
}

let cache: { raw: string | null; value: HistoryEntry[] } | null = null;
const listeners = new Set<() => void>();

export function loadHistory(): HistoryEntry[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(HISTORY_KEY);
  } catch {
    return cache?.value ?? EMPTY;
  }
  if (cache?.raw === raw) return cache.value;
  const value = parseHistory(raw);
  cache = { raw, value };
  return value;
}

function save(entries: HistoryEntry[]): void {
  let raw: string | null = JSON.stringify(entries);
  try {
    localStorage.setItem(HISTORY_KEY, raw);
  } catch {
    // Not written (storage full or blocked): the list lasts for this page
    // view only. The cache stays keyed to what storage still holds, so
    // loadHistory keeps returning the new list instead of re-reading the old.
    raw = cache?.raw ?? null;
  }
  cache = { raw, value: entries };
  for (const fn of listeners) fn();
}

/** Lists a verdict by its date, replacing an entry with the same id. */
export function addHistory(entry: HistoryEntry): void {
  const entries = [entry, ...loadHistory().filter((e) => e.id !== entry.id)];
  entries.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  save(entries.slice(0, HISTORY_MAX));
}

/** A verdict that was indexed when accepted but then failed. */
export function dropHistory(id: string): void {
  const entries = loadHistory();
  if (entries.some((e) => e.id === id)) save(entries.filter((e) => e.id !== id));
}

/** The first time in a browser: creates the empty index and queues the
 * verdicts it wrote before (their owner tokens) to be looked up. */
export function startHistory(ids: string[]): void {
  try {
    if (localStorage.getItem(HISTORY_KEY) !== null) return;
    localStorage.setItem(SEED_KEY, JSON.stringify(ids.slice(0, HISTORY_MAX)));
    localStorage.setItem(HISTORY_KEY, "[]");
  } catch {
    // Storage blocked: nothing to index into.
  }
}

export function seedQueue(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SEED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Whether this tab works on the queue now. Every open tab reads the same
 * queue, so they share one turn per `gapMs`. */
export function takeSeedTurn(now: number, gapMs: number): boolean {
  try {
    if (now - Number(localStorage.getItem(SEED_TURN_KEY)) < gapMs) return false;
    localStorage.setItem(SEED_TURN_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** A queued verdict was looked up (or is gone): it leaves the queue. */
export function seeded(id: string): void {
  const rest = seedQueue().filter((q) => q !== id);
  try {
    if (rest.length) localStorage.setItem(SEED_KEY, JSON.stringify(rest));
    else localStorage.removeItem(SEED_KEY);
  } catch {
    // Looked up again next time.
  }
}

/** After a removal: the entry stays, muted, without its headline. */
export function markHistoryRemoved(id: string): void {
  const entries = loadHistory();
  if (!entries.some((e) => e.id === id)) return;
  save(entries.map((e) => (e.id === id ? { ...e, headline: null, removed: true as const } : e)));
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === HISTORY_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The index: empty while server rendering and on the first client render
 * (so hydration matches), then this browser's entries. */
export function useLocalHistory(): HistoryEntry[] {
  return useSyncExternalStore(subscribe, loadHistory, () => EMPTY);
}
