/** GET /api/v1/me/history: the account's verdicts and cases (started or
 * answered) in one list, newest first. Shared by the website and the apps.
 * Pure module. */

import type { FinalVerdict, NameMapping } from "./types";

/**
 * Where a row stands, from the viewer's side:
 * - judging / rejudging: the judges are working (rejudging: on added context)
 * - failed: the run didn't finish; rejudge_failed: added context didn't go
 *   through, the earlier ruling stands
 * - waiting: a case the viewer started, the other person hasn't answered
 * - expired: that invite closed unanswered
 * - removed: the viewer removed it; removed_by_other: the other party did
 * - ready: a ruling to read
 * Clients should read a state they don't know as "no label".
 */
export type HistoryState =
  | "judging"
  | "failed"
  | "ready"
  | "rejudging"
  | "rejudge_failed"
  | "waiting"
  | "expired"
  | "removed"
  | "removed_by_other";

export type HistoryRow = {
  kind: "verdict" | "case";
  /** Verdict id, or case id. */
  id: string;
  /** Verdicts: always "owner". */
  role: "owner" | "respondent";
  /** The viewer's party: "a" for the owner, "b" for the respondent. */
  party: "a" | "b";
  /** Sort time (ISO): when the verdict was asked for, the case started, or
   * for a case the viewer answered, when they answered. */
  at: string;
  createdAt: string;
  state: HistoryState;
  /** Something waits on the viewer: retry, judge alone, send context again. */
  yourMove: boolean;
  /** The latest ruling the viewer may read, anonymized; null before one
   * exists or once the viewer removed it. */
  verdict: FinalVerdict | null;
  /** The ruling shown came from added context. */
  contextAdded: boolean;
  /** Who added the context being judged (state "rejudging" only). */
  contextBy: "you" | "other" | null;
  /** Anonymized; null when there is none or the viewer removed their side. */
  headline: string | null;
  /** Cases without a headline: the start of the viewer's own side, anonymized. */
  excerpt: string | null;
  /** The viewer's own name map, to put names back and name the other party. */
  nameMap: NameMapping[];
  /** Waiting cases: when the invite closes. */
  expiresAt: string | null;
  /** Its links are closed (by either party). */
  removed: boolean;
  /** The viewer may remove it now: exactly when its page offers Remove. */
  removable: boolean;
  /** Respondent rows: the token of their page, /r/<token>; null when that
   * link no longer opens. */
  inviteToken: string | null;
};

export type HistoryResponse = { items: HistoryRow[]; next: string | null };

/** The list's order key: "v:<id>" for verdicts, "c:<id>" for cases. */
export function historyKey(row: Pick<HistoryRow, "kind" | "id">): string {
  return `${row.kind === "verdict" ? "v" : "c"}:${row.id}`;
}

/** Newest first: by `at`, then by key, both compared as plain strings. */
export function compareHistory(x: Pick<HistoryRow, "kind" | "id" | "at">, y: Pick<HistoryRow, "kind" | "id" | "at">): number {
  if (x.at !== y.at) return x.at < y.at ? 1 : -1;
  const kx = historyKey(x);
  const ky = historyKey(y);
  return kx === ky ? 0 : kx < ky ? 1 : -1;
}
