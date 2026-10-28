/** A Verdicts row's state from the viewer's side, from stored facts (the
 * server's list) or from a case page's view (the website keeps its rows
 * current with it). Pure module. */

import { CASE_EXPIRY_DAYS, type AppealStatus, type CaseStatus, type CaseView, type PartyLetter } from "./case-types";
import type { HistoryRow, HistoryState } from "./history-types";
import type { FinalVerdict, NameMapping } from "./types";

export type DerivedState = Pick<HistoryRow, "state" | "yourMove" | "removable" | "verdict" | "contextAdded" | "contextBy">;

/** After an invite expired the owner can still judge it alone, but "your
 * turn" stops this long after. */
const EXPIRED_MOVE_MS = CASE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

export type CaseFacts = {
  party: PartyLetter;
  /** As stored or as a view reports it: an unanswered case past expiresAt reads as expired. */
  status: CaseStatus;
  expiresAt: string;
  removedA: boolean;
  removedB: boolean;
  appeals: readonly { id: string; party: PartyLetter; status: AppealStatus }[];
  /** The newest verdict that parses. */
  latest: { appealId: string | null; verdict: FinalVerdict } | null;
};

const settled = (state: HistoryState, verdict: FinalVerdict | null = null): DerivedState => ({
  state,
  yourMove: false,
  removable: false,
  verdict,
  contextAdded: false,
  contextBy: null,
});

export function caseHistoryState(f: CaseFacts, now: Date): DerivedState {
  const own = f.party === "a" ? f.removedA : f.removedB;
  const other = f.party === "a" ? f.removedB : f.removedA;
  const latest = f.latest?.verdict ?? null;
  if (own) return settled("removed");
  if (other) return settled("removed_by_other", latest);

  const nowIso = now.toISOString();
  const status = f.status === "awaiting_respondent" && f.expiresAt <= nowIso ? "expired" : f.status;
  const owner = f.party === "a";
  switch (status) {
    case "awaiting_respondent":
      return { ...settled("waiting"), removable: true };
    case "expired":
      return {
        ...settled("expired"),
        yourMove: owner && now.getTime() - Date.parse(f.expiresAt) < EXPIRED_MOVE_MS,
        removable: true,
      };
    case "judging":
      return settled("judging");
    case "failed":
      return { ...settled("failed"), yourMove: owner, removable: true };
    case "judged":
      break;
  }

  const busy = f.appeals.find((a) => a.status === "judging");
  if (busy) {
    return { ...settled("rejudging", latest), contextBy: busy.party === f.party ? "you" : "other" };
  }
  const mine = f.appeals.find((a) => a.party === f.party);
  if (mine?.status === "failed" && f.latest?.appealId !== mine.id) {
    return { ...settled("rejudge_failed", latest), yourMove: true, removable: true };
  }
  return { ...settled("ready", latest), removable: true, contextAdded: Boolean(f.latest?.appealId) };
}

export type VerdictFacts = {
  /** A job with no stored verdict yet: still judging, or it failed. */
  job: "judging" | "failed" | null;
  removed: boolean;
  /** The newest round of added context, if any. */
  round: AppealStatus | null;
  verdict: FinalVerdict | null;
  /** The ruling shown came from a round. */
  fromRound: boolean;
};

export function verdictHistoryState(f: VerdictFacts): DerivedState {
  if (f.job) return settled(f.job);
  if (f.removed) return settled("removed");
  if (f.round === "judging") return { ...settled("rejudging", f.verdict), removable: true, contextBy: "you", contextAdded: f.fromRound };
  if (f.round === "failed") return { ...settled("rejudge_failed", f.verdict), yourMove: true, removable: true, contextAdded: f.fromRound };
  return { ...settled("ready", f.verdict), removable: true, contextAdded: f.fromRound };
}

/** The same derivation from a case page's view. */
export function historyStateFromView(view: CaseView, now: Date): DerivedState {
  const current = view.verdicts.at(-1) ?? null;
  return caseHistoryState(
    {
      party: view.yourParty,
      status: view.status,
      expiresAt: view.expiresAt,
      removedA: view.removed?.parties.includes("a") ?? false,
      removedB: view.removed?.parties.includes("b") ?? false,
      appeals: view.appeals,
      latest: current ? { appealId: current.appealId, verdict: current.result.verdict } : null,
    },
    now,
  );
}

/** A case page's view as a Verdicts row. `at`, the names and the token are
 * what the list already knows (a respondent's view carries no side of theirs
 * before the verdict). */
export function historyRowFromView(
  view: CaseView,
  now: Date,
  known: { at: string; nameMap: NameMapping[]; inviteToken: string | null },
): HistoryRow {
  const derived = historyStateFromView(view, now);
  const own = derived.state === "removed";
  const headline = own ? null : (view.verdicts.at(-1)?.result.headline ?? null);
  const side = view.sides.find((s) => s.party === view.yourParty && !s.removed);
  const respondent = view.role === "respondent";
  return {
    kind: "case",
    id: view.id,
    role: view.role,
    party: view.yourParty,
    at: known.at,
    createdAt: view.createdAt,
    ...derived,
    removable: derived.removable && (!respondent || known.inviteToken !== null),
    headline,
    excerpt: own || headline ? null : excerptOf(side?.text ?? null),
    nameMap: own ? [] : known.nameMap,
    expiresAt: derived.state === "waiting" ? view.expiresAt : null,
    removed: view.removed !== null,
    inviteToken: respondent ? known.inviteToken : null,
  };
}

/** Longest list excerpt, in characters. */
export const EXCERPT_CHARS = 80;

/** The first words of an anonymized side, cut at a word boundary. */
export function excerptOf(text: string | null, max = EXCERPT_CHARS): string | null {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/u, "")}…`;
}
