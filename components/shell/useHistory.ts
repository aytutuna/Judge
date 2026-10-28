"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { CaseListResponse, CaseStatus, CaseSummary, CaseView } from "@/lib/case-types";
import {
  addHistory,
  dropHistory,
  loadHistory,
  markHistoryRemoved,
  seeded,
  seedQueue,
  startHistory,
  takeSeedTurn,
  useLocalHistory,
  type HistoryEntry,
} from "@/lib/history-store";
import { localizeLabelsAuto, resolveParties, restoreNames, textLang } from "@/lib/names";
import type { MineResponse, OwnerVerdictListResponse, OwnerVerdictSummary } from "@/lib/originals-types";
import type { VerdictPollResponse } from "@/lib/verdict-poll";
import { loadOwnerToken, ownerHeaders, ownerTokenIds } from "@/lib/owner-store";
import type { ViewerState } from "@/lib/use-viewer";

export type HistoryItem = {
  kind: "verdict" | "case";
  id: string;
  createdAt: string;
  title: string | null;
  /** Cases only. */
  status: CaseStatus | null;
  removed: boolean;
  /** A verdict this browser sent that has no stored result yet. */
  pending: boolean;
};

export type HistoryView = {
  items: HistoryItem[];
  status: "loading" | "ready" | "error";
  more: boolean;
  loadingMore: boolean;
};

export type ServerHistory = {
  verdicts: OwnerVerdictSummary[];
  cases: CaseSummary[];
  /** The lists' `next` cursors (createdAt of the last row), null at the end. */
  nextVerdicts: string | null;
  nextCases: string | null;
};

const PAGE = 20;
// The lists count against the owner's rate limit (shared with their own
// verdict and case pages), so a page change reuses a recent copy.
const STALE_MS = 2 * 60_000;
// Lookups also share that limit, per address when signed out (60 per 10
// minutes): the queue gets at most this many per page load, and one turn
// across all tabs per window.
const LOOKUPS_PER_LOAD = 10;
const SEED_GAP_MS = 10 * 60_000;

/** The headline with the writer's own names put back (same conservative
 * rules as the verdict card). */
export function restoredHeadline(v: Pick<OwnerVerdictSummary, "headline" | "nameMap">): string | null {
  if (!v.headline) return null;
  const lang = textLang(v.headline);
  return restoreNames(v.headline, resolveParties(v.nameMap, lang, "A"), lang);
}

function fromVerdict(v: OwnerVerdictSummary): HistoryItem {
  return {
    kind: "verdict",
    id: v.id,
    createdAt: v.createdAt,
    title: v.removed ? null : restoredHeadline(v),
    status: null,
    removed: v.removed,
    pending: false,
  };
}

function fromCase(c: CaseSummary): HistoryItem {
  return {
    kind: "case",
    id: c.id,
    createdAt: c.createdAt,
    title: c.headline ?? (c.excerpt ? localizeLabelsAuto(c.excerpt) : null),
    status: c.status,
    removed: c.removed,
    pending: false,
  };
}

function fromEntry(e: HistoryEntry): HistoryItem {
  return {
    kind: "verdict",
    id: e.id,
    createdAt: e.createdAt,
    title: e.headline,
    status: null,
    removed: e.removed === true,
    pending: e.pending === true,
  };
}

/**
 * One list, newest first: the account's verdicts and cases plus this
 * browser's own entries the server did not list. Two cursors page
 * independently, so anything older than the later of them is held back
 * until "load more" reaches it; otherwise an old case could show up above
 * verdicts that are still on the next page.
 */
export function mergeHistory(server: ServerHistory | null, local: HistoryEntry[]): HistoryItem[] {
  const items: HistoryItem[] = [];
  const seen = new Set<string>();
  for (const v of server?.verdicts ?? []) {
    seen.add(v.id);
    items.push(fromVerdict(v));
  }
  for (const c of server?.cases ?? []) items.push(fromCase(c));
  for (const e of local) if (!seen.has(e.id)) items.push(fromEntry(e));
  const cursors = [server?.nextVerdicts, server?.nextCases].filter((c): c is string => typeof c === "string");
  const cutoff = cursors.length ? Math.max(...cursors.map((c) => Date.parse(c))) : null;
  return items
    .filter((i) => cutoff === null || Date.parse(i.createdAt) >= cutoff)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

// The account's lists live at module level so a page change, which mounts
// the list again, shows them at once and only refreshes the first page.

type ServerState = {
  user: string;
  cases: boolean;
  status: "loading" | "ready" | "error";
  data: ServerHistory | null;
  loadingMore: boolean;
};

let state: ServerState | null = null;
let fetchedAt = 0;
const listeners = new Set<() => void>();

function emit(next: ServerState | null): void {
  state = next;
  for (const fn of listeners) fn();
}

async function fetchPage<T>(path: string, before: string | null): Promise<T> {
  const q = `limit=${PAGE}${before ? `&before=${encodeURIComponent(before)}` : ""}`;
  const res = await fetch(`${path}?${q}`, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

function union<T extends { id: string; createdAt: string }>(fresh: T[], old: T[]): T[] {
  const ids = new Set(fresh.map((x) => x.id));
  return [...fresh, ...old.filter((x) => !ids.has(x.id))].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

/** A reloaded first page over the rows already loaded: down to its last
 * row the page is the truth (rows gone from it were removed), older loaded
 * rows stay. The cursor is the older of the two, null once all is loaded. */
export function mergeFirstPage<T extends { id: string; createdAt: string }>(
  fresh: { rows: T[]; next: string | null },
  old: { rows: T[]; next: string | null } | null,
): { rows: T[]; next: string | null } {
  if (!old || fresh.next === null) return fresh;
  const floor = Date.parse(fresh.next);
  const next = old.next === null ? null : Date.parse(old.next) < floor ? old.next : fresh.next;
  return { rows: union(fresh.rows, old.rows.filter((x) => Date.parse(x.createdAt) < floor)), next };
}

/** Reloads the first page of each list, keeping older pages already
 * loaded. A no-op while nobody is signed in. */
export async function refreshHistory(): Promise<void> {
  const start = state;
  if (!start) return;
  fetchedAt = Date.now();
  try {
    const [v, c] = await Promise.all([
      fetchPage<OwnerVerdictListResponse>("/api/v1/me/verdicts", null),
      start.cases ? fetchPage<CaseListResponse>("/api/v1/cases", null) : null,
    ]);
    if (state?.user !== start.user) return;
    const old = state.data;
    const verdicts = mergeFirstPage(
      { rows: v.verdicts, next: v.next },
      old ? { rows: old.verdicts, next: old.nextVerdicts } : null,
    );
    const cases = mergeFirstPage(
      { rows: c?.cases ?? [], next: c?.next ?? null },
      old ? { rows: old.cases, next: old.nextCases } : null,
    );
    emit({
      ...state,
      status: "ready",
      data: { verdicts: verdicts.rows, cases: cases.rows, nextVerdicts: verdicts.next, nextCases: cases.next },
    });
  } catch {
    if (state?.user === start.user && !state.data) emit({ ...state, status: "error" });
  }
}

async function loadMore(): Promise<void> {
  const start = state;
  if (!start?.data || start.loadingMore) return;
  const { nextVerdicts, nextCases } = start.data;
  if (!nextVerdicts && !nextCases) return;
  emit({ ...start, loadingMore: true });
  try {
    const [v, c] = await Promise.all([
      nextVerdicts ? fetchPage<OwnerVerdictListResponse>("/api/v1/me/verdicts", nextVerdicts) : null,
      nextCases ? fetchPage<CaseListResponse>("/api/v1/cases", nextCases) : null,
    ]);
    if (state?.user !== start.user || !state.data) return;
    const data = state.data;
    emit({
      ...state,
      loadingMore: false,
      data: {
        verdicts: v ? union(v.verdicts, data.verdicts) : data.verdicts,
        cases: c ? union(c.cases, data.cases) : data.cases,
        nextVerdicts: v ? v.next : data.nextVerdicts,
        nextCases: c ? c.next : data.nextCases,
      },
    });
  } catch {
    if (state?.user === start.user) emit({ ...state, loadingMore: false });
  }
}

/** After the writer removed a verdict: its row goes muted at once, on
 * whichever page it was loaded, in the account's list and this browser's. */
export function markVerdictRemoved(id: string): void {
  markHistoryRemoved(id);
  const data = state?.data;
  if (!state || !data?.verdicts.some((v) => v.id === id)) return;
  emit({
    ...state,
    data: { ...data, verdicts: data.verdicts.map((v) => (v.id === id ? { ...v, headline: null, removed: true } : v)) },
  });
}

/** A case page's latest state, put into its row (the Verdicts list shows its
 * status and headline). */
export function updateHistoryCase(view: CaseView): void {
  const data = state?.data;
  const row = data?.cases.find((c) => c.id === view.id);
  if (!state || !data || !row) return;
  const latest = view.verdicts.at(-1)?.result ?? null;
  const next: CaseSummary = {
    ...row,
    status: view.status,
    respondentAnswered: view.respondentAnswered,
    removed: view.removed !== null,
    verdict: latest?.verdict ?? row.verdict,
    headline: view.removed ? null : (latest?.headline ?? row.headline),
  };
  if (
    next.status === row.status &&
    next.respondentAnswered === row.respondentAnswered &&
    next.removed === row.removed &&
    next.verdict === row.verdict &&
    next.headline === row.headline
  ) {
    return;
  }
  emit({ ...state, data: { ...data, cases: data.cases.map((c) => (c.id === view.id ? next : c)) } });
}

function forget(id: string): void {
  dropHistory(id);
  seeded(id);
}

/** Fills in one entry this browser could not title yet. False when it
 * should be tried again on a later page load (throttled, offline). */
async function lookUp(id: string): Promise<boolean> {
  const path = `/api/v1/verdicts/${encodeURIComponent(id)}`;
  const poll = await fetch(path, { cache: "no-store" });
  if (poll.status === 404) {
    forget(id);
    return true;
  }
  if (poll.ok) {
    const body = (await poll.json()) as VerdictPollResponse;
    if (body.status === "judging") return true;
    if (body.status === "failed") {
      forget(id);
      return true;
    }
  } else if (poll.status !== 410) {
    return false;
  }
  // Ready or removed: the writer's view has the names and the date.
  const res = await fetch(`${path}/mine`, { cache: "no-store", headers: ownerHeaders(loadOwnerToken(id)) });
  if (res.status === 404) {
    forget(id);
    return true;
  }
  if (!res.ok) return false;
  const mine = (await res.json()) as MineResponse;
  addHistory({
    id,
    createdAt: mine.createdAt,
    headline: mine.removed ? null : restoredHeadline({ headline: mine.result?.headline ?? null, nameMap: mine.nameMap }),
    ...(mine.removed ? { removed: true as const } : {}),
  });
  seeded(id);
  return true;
}

let lookups = 0;
let settling = false;

/** Entries still judging when they were indexed (the tab closed before the
 * verdict came back), then the verdicts written before the index existed.
 * One at a time and a few per page load; anything not reached waits. The
 * judging ones are few and mostly cost a poll, so every tab checks them;
 * the queue can be long and costs a writer's lookup each. */
export async function settleHistory(): Promise<void> {
  if (settling) return;
  settling = true;
  try {
    startHistory(ownerTokenIds());
    const pending = loadHistory()
      .filter((e) => e.pending)
      .map((e) => e.id);
    const queue = seedQueue();
    const ids = [...pending, ...(queue.length && takeSeedTurn(Date.now(), SEED_GAP_MS) ? queue : [])];
    for (const id of ids) {
      if (lookups >= LOOKUPS_PER_LOAD) return;
      lookups++;
      if (!(await lookUp(id).catch(() => false))) return;
    }
  } finally {
    settling = false;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** The Verdicts list for this viewer: this browser's entries at once, and the
 * account's lists once they load. */
export function useHistory(viewer: ViewerState): HistoryView & { loadMore: () => void } {
  const local = useLocalHistory();
  const server = useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );
  const user = viewer.me?.user?.id ?? null;
  const cases = viewer.config?.features?.cases === true;

  useEffect(() => {
    void settleHistory();
  }, []);

  useEffect(() => {
    if (!user) {
      if (state) emit(null);
      return;
    }
    if (state?.user !== user || state.cases !== cases) {
      emit({ user, cases, status: "loading", data: null, loadingMore: false });
    } else if (state.data && Date.now() - fetchedAt < STALE_MS) {
      return;
    }
    void refreshHistory();
  }, [user, cases]);

  const mine = server && server.user === user ? server : null;
  const items = useMemo(() => mergeHistory(mine?.data ?? null, local), [mine?.data, local]);
  return {
    items,
    status: mine
      ? mine.status
      : user || viewer.status === "idle" || viewer.status === "loading"
        ? "loading"
        : "ready",
    more: Boolean(mine?.data?.nextVerdicts || mine?.data?.nextCases),
    loadingMore: mine?.loadingMore ?? false,
    loadMore: () => void loadMore(),
  };
}
