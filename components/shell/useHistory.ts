"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { CaseView } from "@/lib/case-types";
import {
  addAnswered,
  addHistory,
  dropHistory,
  loadAnswered,
  loadHistory,
  markHistoryRemoved,
  seeded,
  seedQueue,
  startHistory,
  takeSeedTurn,
  useLocalAnswered,
  useLocalHistory,
  type HistoryEntry,
} from "@/lib/history-store";
import { historyRowFromView } from "@/lib/history-state";
import { historyKey, type HistoryResponse, type HistoryRow, type HistoryState } from "@/lib/history-types";
import { localizeLabelsAuto, resolveParties, restoreNames, textLang } from "@/lib/names";
import { firstNameOf, type MineResponse } from "@/lib/originals-types";
import { loadClaim } from "@/lib/respondent-store";
import type { FinalVerdict, NameMapping } from "@/lib/types";
import type { VerdictPollResponse } from "@/lib/verdict-poll";
import { loadOwnerToken, ownerHeaders, ownerTokenIds } from "@/lib/owner-store";
import type { ViewerState } from "@/lib/use-viewer";

export type HistoryItem = {
  kind: "verdict" | "case";
  id: string;
  /** Sort time: asked for, started, or for a case you answered, answered. */
  at: string;
  role: "owner" | "respondent";
  /** The viewer's party. */
  party: "a" | "b";
  title: string | null;
  /** Null: nothing known beyond the title (an entry of this browser's). */
  state: HistoryState | null;
  verdict: FinalVerdict | null;
  /** First names from the viewer's own map: the other party, and the viewer
   * when they wrote about themselves by name. */
  other: string | null;
  self: string | null;
  yourMove: boolean;
  contextAdded: boolean;
  removed: boolean;
  /** Where the row opens; null when it is listed but not linked. */
  href: string | null;
};

export type HistoryView = {
  items: HistoryItem[];
  status: "loading" | "ready" | "error";
  more: boolean;
  loadingMore: boolean;
};

export type ServerHistory = { rows: HistoryRow[]; next: string | null };

const PAGE = 20;
// A page change reuses a recent copy.
const STALE_MS = 2 * 60_000;
// While the judges work on a listed row, the first page is reloaded this often.
const POLL_MS = 20_000;
// Lookups share the owner's rate limit, per address when signed out (60 per
// 10 minutes): the queue gets at most this many per page load, and one turn
// across all tabs per window.
const LOOKUPS_PER_LOAD = 10;
const SEED_GAP_MS = 10 * 60_000;

const THINKING: ReadonlySet<HistoryState | null> = new Set(["judging", "rejudging"]);

/** The headline with the writer's own names put back (same conservative
 * rules as the verdict card). */
export function restoredHeadline(v: { headline: string | null; nameMap: NameMapping[] }): string | null {
  if (!v.headline) return null;
  const lang = textLang(v.headline);
  return restoreNames(v.headline, resolveParties(v.nameMap, lang, "A"), lang);
}

function hrefOf(row: HistoryRow): string | null {
  const id = encodeURIComponent(row.id);
  if (row.kind === "verdict") return row.removed || row.state === "judging" || row.state === "failed" ? null : `/v/${id}`;
  if (row.role === "respondent") return row.inviteToken ? `/r/${row.inviteToken}` : null;
  return `/c/${id}`;
}

export function fromRow(row: HistoryRow): HistoryItem {
  const text = row.headline ?? row.excerpt;
  const lang = textLang(text ?? "");
  const own = row.party === "a" ? "A" : "B";
  const parties = resolveParties(row.nameMap, lang, own);
  const named = (letter: string) => {
    const p = parties.get(letter);
    return p && !p.self ? (firstNameOf(p.name) ?? p.name) : null;
  };
  return {
    kind: row.kind,
    id: row.id,
    at: row.at,
    role: row.role,
    party: row.party,
    title: text ? localizeLabelsAuto(restoreNames(text, parties, lang)) : null,
    state: row.state,
    verdict: row.verdict,
    other: named(own === "A" ? "B" : "A"),
    self: named(own),
    yourMove: row.yourMove,
    contextAdded: row.contextAdded,
    removed: row.removed,
    href: hrefOf(row),
  };
}

function fromEntry(e: HistoryEntry): HistoryItem {
  const removed = e.removed === true;
  const pending = e.pending === true;
  return {
    kind: "verdict",
    id: e.id,
    at: e.createdAt,
    role: "owner",
    party: "a",
    title: e.headline,
    state: removed ? "removed" : pending ? "judging" : null,
    verdict: null,
    other: null,
    self: null,
    yourMove: false,
    contextAdded: false,
    removed,
    // Its share page 404s until the verdict is stored, and closes once removed.
    href: removed || pending ? null : `/v/${encodeURIComponent(e.id)}`,
  };
}

/** Newest first; local entries' times are compared as dates. */
type Sortable = Pick<HistoryRow, "kind" | "id" | "at">;

function newestFirst(x: Sortable, y: Sortable): number {
  const d = Date.parse(y.at) - Date.parse(x.at);
  if (d !== 0) return d;
  const kx = historyKey(x);
  const ky = historyKey(y);
  return kx === ky ? 0 : kx < ky ? 1 : -1;
}

/**
 * One list, newest first: the account's rows plus this browser's own
 * entries (verdicts written and cases answered signed out) the server did
 * not list. While a page is left, local entries older than the last row
 * loaded wait for "Show more", so nothing shows up above rows still to come.
 */
export function mergeHistory(server: ServerHistory | null, local: HistoryEntry[], answered: HistoryRow[] = []): HistoryItem[] {
  const seen = new Set((server?.rows ?? []).map(historyKey));
  const items = (server?.rows ?? []).map(fromRow);
  const extra = [
    ...local.filter((e) => !seen.has(`v:${e.id}`)).map(fromEntry),
    ...answered.filter((r) => !seen.has(historyKey(r))).map(fromRow),
  ];
  const floor = server?.next ? server.rows.at(-1) : undefined;
  for (const item of extra) if (!floor || newestFirst(item, floor) <= 0) items.push(item);
  return items.sort(newestFirst);
}

/** A reloaded first page over the rows already loaded: down to its last
 * row the page is the truth (rows gone from it were removed), older loaded
 * rows stay. The cursor is the deeper of the two, null once all is loaded. */
export function mergeFirstPage(fresh: ServerHistory, old: ServerHistory | null): ServerHistory {
  const floor = fresh.rows.at(-1);
  if (!old || fresh.next === null || !floor) return fresh;
  const below = old.rows.filter((r) => newestFirst(r, floor) > 0);
  const oldLast = old.rows.at(-1);
  const next = old.next === null ? null : oldLast && newestFirst(oldLast, floor) > 0 ? old.next : fresh.next;
  return { rows: [...fresh.rows, ...below], next };
}

// The account's list lives at module level so a page change, which mounts
// the list again, shows it at once and only refreshes the first page.

type ServerState = {
  user: string;
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

async function fetchPage(cursor: string | null): Promise<HistoryResponse> {
  const q = `limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const res = await fetch(`/api/v1/me/history?${q}`, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as HistoryResponse;
}

/** Reloads the first page, keeping older pages already loaded. A no-op
 * while nobody is signed in. */
export async function refreshHistory(): Promise<void> {
  const start = state;
  if (!start) return;
  fetchedAt = Date.now();
  try {
    const page = await fetchPage(null);
    if (state?.user !== start.user) return;
    emit({ ...state, status: "ready", data: mergeFirstPage({ rows: page.items, next: page.next }, state.data) });
  } catch {
    if (state?.user === start.user && !state.data) emit({ ...state, status: "error" });
  }
}

async function loadMore(): Promise<void> {
  const start = state;
  if (!start?.data?.next || start.loadingMore) return;
  emit({ ...start, loadingMore: true });
  try {
    const page = await fetchPage(start.data.next);
    if (state?.user !== start.user || !state.data) return;
    const have = new Set(state.data.rows.map(historyKey));
    emit({
      ...state,
      loadingMore: false,
      data: { rows: [...state.data.rows, ...page.items.filter((r) => !have.has(historyKey(r)))], next: page.next },
    });
  } catch {
    if (state?.user === start.user) emit({ ...state, loadingMore: false });
  }
}

function patchRow(key: string, update: (row: HistoryRow) => HistoryRow): void {
  const data = state?.data;
  const row = data?.rows.find((r) => historyKey(r) === key);
  if (!state || !data || !row) return;
  const next = update(row);
  if (JSON.stringify(next) === JSON.stringify(row)) return;
  emit({ ...state, data: { ...data, rows: data.rows.map((r) => (r === row ? next : r)) } });
}

/** After the writer removed a verdict: its row goes muted at once, on
 * whichever page it was loaded, in the account's list and this browser's. */
export function markVerdictRemoved(id: string): void {
  markHistoryRemoved(id);
  patchRow(`v:${id}`, (r) => ({
    ...r,
    state: "removed",
    yourMove: false,
    removable: false,
    verdict: null,
    contextAdded: false,
    contextBy: null,
    headline: null,
    nameMap: [],
    removed: true,
  }));
}

/** A case page's latest state, put into its row: in the account's list and,
 * for a case this browser answered, in its own. */
export function updateHistoryCase(view: CaseView): void {
  const now = new Date();
  patchRow(`c:${view.id}`, (r) =>
    r.role === view.role
      ? historyRowFromView(view, now, { at: r.at, nameMap: view.names ?? r.nameMap, inviteToken: r.inviteToken })
      : r,
  );
  if (view.role !== "respondent") return;
  const local = loadAnswered().find((r) => r.id === view.id);
  if (local) addAnswered(historyRowFromView(view, now, { at: local.at, nameMap: view.names ?? local.nameMap, inviteToken: local.inviteToken }));
}

/** A case this browser answered signed out (it holds the claim), listed
 * here until it is in the account; refreshed whenever its page shows it. */
export function rememberAnswered(view: CaseView, token: string, names: NameMapping[]): void {
  if (view.role !== "respondent" || !view.respondentAnswered || view.ownInvite) return;
  const known = loadAnswered().find((r) => r.id === view.id);
  addAnswered(
    historyRowFromView(view, new Date(), {
      at: known?.at ?? view.sides.find((s) => s.party === "b")?.submittedAt ?? new Date().toISOString(),
      nameMap: names.length ? names : (known?.nameMap ?? []),
      inviteToken: token,
    }),
  );
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

/** A case this browser answered, still being judged when last seen. */
async function lookUpAnswered(row: HistoryRow): Promise<boolean> {
  const claim = loadClaim(row.id);
  if (!row.inviteToken) return true;
  const res = await fetch(`/api/v1/respond/${row.inviteToken}`, {
    cache: "no-store",
    headers: claim ? { "Respondent-Claim": claim } : {},
  });
  if (!res.ok) return res.status === 404;
  updateHistoryCase(((await res.json()) as { case: CaseView }).case);
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
    for (const row of loadAnswered().filter((r) => THINKING.has(r.state))) {
      if (lookups >= LOOKUPS_PER_LOAD) return;
      lookups++;
      if (!(await lookUpAnswered(row).catch(() => false))) return;
    }
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
 * account's list once it loads. */
export function useHistory(viewer: ViewerState): HistoryView & { loadMore: () => void } {
  const local = useLocalHistory();
  const answered = useLocalAnswered();
  const server = useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );
  const user = viewer.me?.user?.id ?? null;

  useEffect(() => {
    void settleHistory();
  }, []);

  useEffect(() => {
    if (!user) {
      if (state) emit(null);
      return;
    }
    if (state?.user !== user) {
      emit({ user, status: "loading", data: null, loadingMore: false });
    } else if (state.data && Date.now() - fetchedAt < STALE_MS) {
      return;
    }
    void refreshHistory();
  }, [user]);

  const mine = server && server.user === user ? server : null;
  const thinking = Boolean(mine?.data?.rows.some((r) => THINKING.has(r.state)));
  useEffect(() => {
    if (!thinking) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshHistory();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [thinking]);

  const items = useMemo(() => mergeHistory(mine?.data ?? null, local, answered), [mine?.data, local, answered]);
  return {
    items,
    status: mine
      ? mine.status
      : user || viewer.status === "idle" || viewer.status === "loading"
        ? "loading"
        : "ready",
    more: Boolean(mine?.data?.next),
    loadingMore: mine?.loadingMore ?? false,
    loadMore: () => void loadMore(),
  };
}
