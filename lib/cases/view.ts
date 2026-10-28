/**
 * CaseView: what one party may see of a case. Pure.
 *
 * Visibility rules:
 * - Before a two-sided verdict nobody sees the other side's text. The owner
 *   sees side A (their own, as the judges read it); the respondent view
 *   carries no sides at all, because the link alone is the credential and
 *   the owner holds the link too.
 * - After a two-sided verdict both parties see both anonymized accounts,
 *   their transcripts, the appeals and every verdict.
 * - A case the owner judged on their side alone shows the respondent no
 *   verdict and no text ("settled without your side").
 * - After a party removed their side, that side's text, transcripts and
 *   appeal text are left out for everyone; the verdicts stay listed for
 *   both parties (their share links are closed).
 */

import {
  CASE_POLL_MS,
  type AppealBlock,
  type CaseAppealView,
  type CaseEvidenceView,
  type CaseRole,
  type CaseSideView,
  type CaseSummary,
  type CaseView,
  type PartyLetter,
} from "@/lib/case-types";
import type { OriginalStatus } from "@/lib/originals-types";
import type { NameMapping } from "@/lib/types";
import type { CaseBundle, CaseListRow, EvidenceRow } from "./db";
import { effectiveStatus } from "./sweep";

export type ViewContext = {
  role: CaseRole;
  now: Date;
  /** Owner, while awaiting: the re-derived invite URL. */
  inviteUrl: string | null;
  /** Respondent role: the signed-in viewer is the owner. */
  ownInvite: boolean;
  /** Why the viewer cannot appeal right now (null = allowed). */
  appealBlock: AppealBlock | null;
  /** Respondent role: side B is bound to the signed-in viewer. */
  inAccount?: boolean;
  /** Decrypted by the caller: the viewer's own name map (null when not
   * stored or the viewer is not proven to be that party), both display
   * names, and the status of the viewer's side original. */
  originals?: {
    names: NameMapping[] | null;
    display: { a: string | null; b: string | null };
    yourOriginal: OriginalStatus;
  };
};

const evidenceView = (rows: readonly EvidenceRow[]): CaseEvidenceView[] =>
  [...rows].sort((x, y) => x.seq - y.seq).map((r) => ({ id: r.id, kind: r.kind, transcript: r.transcript }));

/** True once a verdict exists that both parties may read. */
export function twoSidedJudged(bundle: CaseBundle): boolean {
  return bundle.row.mode === "two_sided" && bundle.verdicts.length > 0;
}

export function buildCaseView(bundle: CaseBundle, ctx: ViewContext): CaseView {
  const { row } = bundle;
  const status = effectiveStatus(row, ctx.now);
  const yourParty: PartyLetter = ctx.role === "owner" ? "a" : "b";
  const shared = twoSidedJudged(bundle);
  // The respondent sees nothing of a case settled without their side.
  const respondentShut = ctx.role === "respondent" && row.mode === "one_sided";

  const removedParties: PartyLetter[] = [
    ...(row.removedAAt ? (["a"] as const) : []),
    ...(row.removedBAt ? (["b"] as const) : []),
  ];
  const isRemoved = (p: PartyLetter) => removedParties.includes(p);

  const visibleParties: PartyLetter[] = shared ? ["a", "b"] : ctx.role === "owner" ? ["a"] : [];
  const sides: CaseSideView[] = bundle.sides
    .filter((s) => visibleParties.includes(s.party))
    .map((s) =>
      isRemoved(s.party)
        ? { party: s.party, text: "", evidence: [], submittedAt: s.submittedAt, removed: true as const }
        : {
            party: s.party,
            text: s.text,
            evidence: evidenceView(bundle.evidence.filter((e) => e.party === s.party && e.appealId === null)),
            submittedAt: s.submittedAt,
          },
    );

  const appeals: CaseAppealView[] = respondentShut
    ? []
    : bundle.appeals.map((a) => ({
        id: a.id,
        party: a.party,
        status: a.status,
        error: a.error,
        text: isRemoved(a.party) ? "" : a.text,
        evidence: isRemoved(a.party) ? [] : evidenceView(bundle.evidence.filter((e) => e.appealId === a.id)),
        outcome: a.outcome,
        verdictId: a.resultSeq === null ? null : (bundle.verdicts.find((v) => v.seq === a.resultSeq)?.verdictId ?? null),
        createdAt: a.createdAt,
        ...(isRemoved(a.party) ? { removed: true as const } : {}),
      }));

  const verdicts = respondentShut
    ? []
    : bundle.verdicts
        .filter((v) => v.result !== null)
        .map((v) => ({ seq: v.seq, id: v.verdictId, result: v.result!, appealId: v.appealId, createdAt: v.createdAt }));

  const appealJudging = bundle.appeals.some((a) => a.status === "judging");
  const judging = status === "judging" || appealJudging;
  const canJudgeNow =
    ctx.role === "owner" &&
    !row.removedAt &&
    (status === "awaiting_respondent" || status === "expired" || status === "failed");

  return {
    id: row.id,
    role: ctx.role,
    yourParty,
    status,
    mode: row.mode,
    tier: row.tier,
    lang: row.lang,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    judgedAt: row.judgedAt,
    respondentAnswered: bundle.sides.some((s) => s.party === "b"),
    inviteUrl: ctx.role === "owner" && status === "awaiting_respondent" ? ctx.inviteUrl : null,
    ownInvite: ctx.role === "respondent" && ctx.ownInvite,
    sides,
    verdicts,
    appeals,
    canJudgeNow,
    appeal: row.removedAt
      ? { allowed: false, blockedBy: "not_judged" }
      : { allowed: ctx.appealBlock === null, blockedBy: ctx.appealBlock },
    lastError: status === "failed" ? row.lastError : null,
    pollAfterMs: judging ? CASE_POLL_MS : null,
    names: ctx.originals?.names ?? null,
    display: {
      namesVisible: row.namesVisible,
      a: ctx.originals?.display.a ?? null,
      b: ctx.originals?.display.b ?? null,
    },
    removed: row.removedAt ? { at: row.removedAt, parties: removedParties } : null,
    yourOriginal: ctx.originals?.yourOriginal ?? "not_stored",
    ...(ctx.role === "respondent" ? { inAccount: ctx.inAccount === true } : {}),
  };
}

/** Why `party` cannot appeal, before the entitlement is consulted (null =
 * structurally allowed). `viewerId` is the signed-in account, if any;
 * `claimOk` says the request carries side B's claim secret. Party B is the
 * account bound to side B or, while none is, whoever holds the claim (they
 * still need to sign in). Anyone else holding the link is not a party. */
export function structuralAppealBlock(
  bundle: CaseBundle,
  party: PartyLetter,
  viewerId: string | null,
  now: Date,
  claimOk = false,
): AppealBlock | null {
  const { row } = bundle;
  if (effectiveStatus(row, now) !== "judged" || bundle.verdicts.length === 0) return "not_judged";
  if (party === "b") {
    if (row.mode !== "two_sided") return "not_party";
    if (!row.respondentUserId && !claimOk) return "not_party";
    if (!viewerId) return "signin_required";
    if (viewerId === row.ownerId) return "not_party";
    if (row.respondentUserId && row.respondentUserId !== viewerId) return "not_party";
  } else if (!viewerId || viewerId !== row.ownerId) {
    return viewerId ? "not_party" : "signin_required";
  }
  if (bundle.appeals.some((a) => a.status === "judging")) return "busy";
  if (bundle.appeals.some((a) => a.party === party && a.status === "judged")) return "appeal_used";
  return null;
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

export function caseSummary(r: CaseListRow, now: Date): CaseSummary {
  return {
    id: r.id,
    status: effectiveStatus(r, now),
    mode: r.mode,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    respondentAnswered: r.respondentAnswered,
    verdict: r.latestResult?.verdict ?? null,
    headline: r.removedAAt ? null : (r.latestResult?.headline ?? null),
    excerpt: r.removedAAt ? null : excerptOf(r.sideAStart),
    removed: r.removedAt !== null,
  };
}
