"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { CaseView } from "@/lib/case-types";
import {
  addAnswered,
  addHistory,
  dropAnswered,
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
import { linkStoredClaim } from "@/lib/respondent-store";
import type { FinalVerdict, NameMapping, PartyId } from "@/lib/types";
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
  party: "a" | "b" | "c" | "d";
  title: string | null;
  /** Null: nothing known beyond the title (an entry of this browser's). */
  state: HistoryState | null;
  verdict: FinalVerdict | null;
  /** The winning side of a verdict with three or four, null when too close;
   * absent otherwise. `verdict` is only the older projection there. */
  winner?: PartyId | null;
  /** First names from the viewer's own map: the winner (or the other party in
   * a two-sided verdict), and the viewer when they wrote about themselves by
   * name. */
  other: string | null;
  self: string | null;
  yourMove: boolean;
  contextAdded: boolean;
  removed: boolean;
  /** The viewer may remove it now. */
  removable: boolean;
  /** Where the row opens; null when it is listed but not linked. */
  href: string | null;
};

export type HistoryView = {
  items: HistoryItem[];
  status: "loading" | "ready" | "error";
  more: boolean;
  loadingMore: boolean;
  moreFailed: boolean;
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
  const own = row.party.toUpperCase() as "A" | "B" | "C" | "D";
  const parties = resolveParties(row.nameMap, lang, own, row.parties ? { sides: row.parties.length } : {});
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
    ...(row.parties && row.winner !== undefined ? { winner: row.winner } : {}),
    other: row.winner ? named(row.winner.toUpperCase()) : named(own === "A" ? "B" : "A"),
    // In a case the viewer is known to be their party: "You're right" even
    // when they named themselves.
    self: row.kind === "verdict" ? named(own) : null,
    yourMove: row.yourMove,
    contextAdded: row.contextAdded,
    removed: row.removed,
    removable: row.removable,
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
    state: removed ? "removed" : pending ? "judging" : e.verdict ? "ready" : null,
    verdict: removed || pending ? null : (e.verdict ?? null),
    other: null,
    self: null,
    yourMove: false,
    contextAdded: false,
    removed,
    removable: !removed && !pending,
    // Its share page 404s until the verdict is stored, and closes once removed.
    href: removed || pending ? null : `/v/${encodeURIComponent(e.id)}`,
  };
}

/** The rows the menu lists: one the viewer removed is left out, one the
 * other side removed stays, as it tells them something. */
export function visibleItems(items: HistoryItem[]): HistoryItem[] {
  return items.filter((i) => i.state !== "removed");
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
  /** The last page asked for did not load; nothing asks again by itself. */
  moreFailed?: boolean;
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
  const res = await apiFetch(`/api/v1/me/history?${q}`, { cache: "no-store" });
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
    emit({ ...state, status: "ready", moreFailed: false, data: mergeFirstPage({ rows: page.items, next: page.next }, state.data) });
  } catch {
    if (state?.user === start.user) emit({ ...state, status: "error" });
  }
}

/** Loads every page left, so "Remove all" can name everything it removes. */
export async function loadAllHistory(): Promise<void> {
  for (;;) {
    const cursor = state?.data?.next;
    if (!cursor) return;
    while (state?.loadingMore) await new Promise((r) => setTimeout(r, 50));
    if (state?.data?.next !== cursor) continue;
    await loadMore();
    if (state?.data?.next === cursor) return;
  }
}

async function loadMore(): Promise<void> {
  const start = state;
  if (!start?.data?.next || start.loadingMore) return;
  emit({ ...start, loadingMore: true, moreFailed: false });
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
    if (state?.user === start.user) emit({ ...state, loadingMore: false, moreFailed: true });
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

const asRemoved = (r: HistoryRow): HistoryRow => ({
  ...r,
  state: "removed",
  yourMove: false,
  removable: false,
  verdict: null,
  contextAdded: false,
  contextBy: null,
  headline: null,
  excerpt: null,
  nameMap: [],
  expiresAt: null,
  removed: true,
});

/** After the writer removed a verdict: its row goes muted at once, on
 * whichever page it was loaded, in the account's list and this browser's. */
export function markVerdictRemoved(id: string): void {
  markHistoryRemoved(id);
  patchRow(`v:${id}`, asRemoved);
}

/** After the viewer removed a case (their own or one they answered). */
export function markCaseRemoved(id: string): void {
  dropAnswered(id);
  patchRow(`c:${id}`, asRemoved);
}

// Side B is linked to no account: only this browser's claim keeps the case.
// Once it is in one, the browser lists it no more, so whoever uses the
// browser next does not see it.
const localOnly = (view: CaseView) => view.inAccount === false;

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
  if (!localOnly(view)) {
    dropAnswered(view.id);
    return;
  }
  const local = loadAnswered().find((r) => r.id === view.id);
  if (local) addAnswered(historyRowFromView(view, now, { at: local.at, nameMap: view.names ?? local.nameMap, inviteToken: local.inviteToken }));
}

/** Claims that could not settle (another side held, server trouble); tried again after a reload, not on every mount. */
const unsettled = new Set<string>();

/** Answers this browser gave signed out join the account that signed in; a
 * claim the server refuses belongs to someone else and its row goes. True
 * when any joined, so the account's list should be read again. */
async function linkAnsweredClaims(user: string): Promise<boolean> {
  let joined = false;
  for (const row of loadAnswered()) {
    if (unsettled.has(`${user}:${row.id}`)) continue;
    const out = await linkStoredClaim(row.id);
    if (out === "conflict" || out === "retry") unsettled.add(`${user}:${row.id}`);
    if (out === "linked" || out === "refused") dropAnswered(row.id);
    if (out === "linked") joined = true;
  }
  return joined;
}

function forget(id: string): void {
  dropHistory(id);
  seeded(id);
}

/** Fills in one entry this browser could not title yet. False when it
 * should be tried again on a later page load (throttled, offline). */
async function lookUp(id: string): Promise<boolean> {
  const path = `/api/v1/verdicts/${encodeURIComponent(id)}`;
  const poll = await apiFetch(path, { cache: "no-store" });
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
  const res = await apiFetch(`${path}/mine`, { cache: "no-store", headers: ownerHeaders(loadOwnerToken(id)) });
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
    ...(mine.removed ? { removed: true as const } : mine.result ? { verdict: mine.result.verdict } : {}),
  });
  seeded(id);
  return true;
}

/** A case this browser answered, still being judged when last seen. */
async function lookUpAnswered(row: HistoryRow): Promise<boolean> {
  if (!row.inviteToken) return true;
  const signedIn = Boolean(state?.user);
  const link = signedIn ? await linkStoredClaim(row.id) : "none";
  if (link === "refused") {
    dropAnswered(row.id);
    return true;
  }
  const res = await apiFetch(`/api/v1/respond/${row.inviteToken}`, { cache: "no-store" });
  if (res.status === 404) {
    // The link no longer opens (the case is gone or its secret changed).
    dropAnswered(row.id);
    return true;
  }
  if (!res.ok) return false;
  const seen = ((await res.json()) as { case: CaseView }).case;
  // Without this answer's account the link speaks for whichever side is open,
  // not for this row's: leave the row as it is and stop looking it up this session.
  if (seen.yourParty !== row.party) unmatched.add(row.id);
  else if (loadAnswered().some((r) => r.id === row.id)) updateHistoryCase(seen);
  return true;
}

/** Answered rows the link cannot speak for; not looked up again until a reload. */
const unmatched = new Set<string>();
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
    for (const row of loadAnswered().filter((r) => THINKING.has(r.state) && !unmatched.has(r.id))) {
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
 * account's list once it loads. `poll`: while it is on screen, reload the
 * first page now and then while the judges work on a row. */
export function useHistory(viewer: ViewerState, poll = false): HistoryView & { loadMore: () => void; refresh: () => void } {
  const local = useLocalHistory();
  const answered = useLocalAnswered();
  const server = useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );
  const user = viewer.me?.user?.id ?? null;
  const blocked = viewer.me?.age?.blocked === true;

  useEffect(() => {
    void settleHistory();
  }, []);

  // A block lifted by a date of birth: claims that failed while blocked may settle now.
  const wasBlocked = useRef(blocked);
  useEffect(() => {
    if (wasBlocked.current && !blocked) unsettled.clear();
    wasBlocked.current = blocked;
  }, [blocked]);

  useEffect(() => {
    // Not while blocked: the claims are tried when the block lifts.
    if (!user || blocked) return;
    void linkAnsweredClaims(user).then((joined) => {
      if (joined) void refreshHistory();
    });
  }, [user, blocked]);

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
    // A block lifted by a date of birth: what failed while blocked loads again.
  }, [user, blocked]);

  const mine = server && server.user === user ? server : null;
  const thinking = poll && Boolean(mine?.data?.rows.some((r) => THINKING.has(r.state)));
  useEffect(() => {
    if (!thinking) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshHistory();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [thinking]);

  const items = useMemo(() => {
    const all = visibleItems(mergeHistory(mine?.data ?? null, local, answered));
    // An answer given signed out can only be removed once its account is signed in.
    return user ? all : all.map((i) => (i.role === "respondent" && i.removable ? { ...i, removable: false } : i));
  }, [mine?.data, local, answered, user]);
  return {
    items,
    status: mine
      ? mine.status
      : user || viewer.status === "idle" || viewer.status === "loading"
        ? "loading"
        : "ready",
    more: Boolean(mine?.data?.next),
    loadingMore: mine?.loadingMore ?? false,
    moreFailed: mine?.moreFailed ?? false,
    loadMore: () => void loadMore(),
    refresh: () => void refreshHistory(),
  };
}
