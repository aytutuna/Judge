/**
 * CaseView: what one party may see of a case. Pure.
 *
 * Visibility rules:
 * - Before a two-sided verdict nobody sees the other side's text. The owner
 *   sees side A (their own, as the judges read it); the respondent view
 *   carries no sides at all, because the link alone is the credential and
 *   the owner holds the link too.
 * - A case can wait without side A (the link was sent first): the owner view
 *   then has no sides and ownerSideMissing is set, for both roles. Once side B
 *   is in, the invite link is gone.
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
  type CaseInviteView,
  type CaseRole,
  type CaseSideView,
  type CaseSummary,
  type CaseView,
  type PartyLetter,
} from "@/lib/case-types";
import { excerptOf } from "@/lib/history-state";
import { partiesFor } from "@/lib/multi";
import type { OriginalStatus } from "@/lib/originals-types";
import type { NameMapping } from "@/lib/types";
import { respondentOf, type CaseBundle, type CaseListRow, type EvidenceRow } from "./db";
import { liveSides } from "./seats";
import { effectiveStatus } from "./sweep";

export type ViewContext = {
  role: CaseRole;
  now: Date;
  /** Owner, while awaiting: the re-derived invite URL. */
  inviteUrl: string | null;
  /** Respondent role: the signed-in viewer is the owner. */
  ownInvite: boolean;
  /** Respondent role: which side the link is for (default b). */
  party?: PartyLetter;
  /** Why the viewer cannot appeal right now (null = allowed). */
  appealBlock: AppealBlock | null;
  /** Respondent role: side B is bound to the signed-in viewer. */
  inAccount?: boolean;
  /** Respondent role, claim holder: side B is bound to some other account. */
  inOtherAccount?: boolean;
  /** Decrypted by the caller: the viewer's own name map (null when not
   * stored or the viewer is not proven to be that party), both display
   * names, and the status of the viewer's side original. */
  originals?: {
    names: NameMapping[] | null;
    display: { a: string | null; b: string | null; c?: string | null; d?: string | null };
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
  const yourParty: PartyLetter = ctx.role === "owner" ? "a" : (ctx.party ?? "b");
  const many = row.sides > 2 && row.mode !== "one_sided";
  const allParties: PartyLetter[] = many ? partiesFor(row.sides) : ["a", "b"];
  const shared = twoSidedJudged(bundle);
  // The respondent sees nothing of a case settled without their side: one
  // judged on side A alone, or judged without the side their link is for.
  const respondentShut =
    ctx.role === "respondent" &&
    (row.mode === "one_sided" ||
      !allParties.includes(yourParty) ||
      (status !== "awaiting_respondent" && !bundle.sides.some((s) => s.party === yourParty)));

  const removedParties: PartyLetter[] = [
    ...(row.removedAAt ? (["a"] as const) : []),
    ...(row.removedBAt ? (["b"] as const) : []),
    ...(row.removedCAt ? (["c"] as const) : []),
    ...(row.removedDAt ? (["d"] as const) : []),
  ];
  const isRemoved = (p: PartyLetter) => removedParties.includes(p);

  const visibleParties: PartyLetter[] = respondentShut ? [] : shared ? allParties : ctx.role === "owner" ? ["a"] : [];
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

  // A respondent is asked about their own side, not about B.
  const respondentAnswered = bundle.sides.some((s) => s.party === (ctx.role === "respondent" ? yourParty : "b"));
  const appealJudging = bundle.appeals.some((a) => a.status === "judging");
  const judging = status === "judging" || appealJudging;
  const ownerSideMissing = !row.removedAt && !bundle.sides.some((s) => s.party === "a");
  const canJudgeNow =
    ctx.role === "owner" &&
    !row.removedAt &&
    !ownerSideMissing &&
    (status === "awaiting_respondent" || status === "expired" || status === "failed");
  const present = new Set(bundle.sides.map((s) => s.party));
  const prefix = allParties.filter((p, i) => allParties.slice(0, i + 1).every((q) => present.has(q)));
  const canJudgeAnswered =
    many && canJudgeNow && (status === "awaiting_respondent" || status === "expired") && prefix.length >= 2 && present.size === prefix.length;
  const invites: CaseInviteView[] | undefined =
    many && ctx.role === "owner"
      ? allParties.slice(1).map((party) => {
          const answered = bundle.sides.find((s) => s.party === party);
          const inviteStatus = answered ? "answered" : status === "awaiting_respondent" ? "waiting" : "closed";
          return {
            party,
            status: inviteStatus,
            inviteUrl: inviteStatus === "waiting" ? ctx.inviteUrl : null,
            answeredAt: answered?.submittedAt ?? null,
          };
        })
      : undefined;

  const live = ctx.role === "owner" && !row.removedAt ? liveSides(bundle, ctx.now) : undefined;
  const unanswered = live?.some((l) => l.state !== "answered") ?? false;
  const owner = ctx.role === "owner";

  return {
    id: row.id,
    role: ctx.role,
    yourParty,
    status,
    mode: row.mode,
    tier: row.tier,
    lang: row.lang,
    venue: row.venue,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    judgedAt: row.judgedAt,
    respondentAnswered,
    ...(many ? { parties: allParties } : {}),
    ...(invites ? { invites } : {}),
    ...(live ? { live } : {}),
    inviteUrl: owner && status === "awaiting_respondent" && unanswered ? ctx.inviteUrl : null,
    ownInvite: ctx.role === "respondent" && ctx.ownInvite,
    sides,
    verdicts,
    appeals,
    canJudgeNow,
    ...(many && ctx.role === "owner" ? { canJudgeAnswered } : {}),
    ownerSideMissing,
    appeal: row.removedAt
      ? { allowed: false, blockedBy: "not_judged" }
      : { allowed: ctx.appealBlock === null, blockedBy: ctx.appealBlock },
    lastError: status === "failed" ? row.lastError : null,
    pollAfterMs: judging || (owner && status === "awaiting_respondent" && unanswered) ? CASE_POLL_MS : null,
    names: ctx.originals?.names ?? null,
    display: {
      namesVisible: row.namesVisible,
      a: ctx.originals?.display.a ?? null,
      b: ctx.originals?.display.b ?? null,
      ...(many ? { c: ctx.originals?.display.c ?? null, d: row.sides > 3 ? (ctx.originals?.display.d ?? null) : null } : {}),
    },
    removed: row.removedAt ? { at: row.removedAt, parties: removedParties } : null,
    yourOriginal: ctx.originals?.yourOriginal ?? "not_stored",
    ...(ctx.role === "respondent" ? { inAccount: ctx.inAccount === true, inOtherAccount: ctx.inOtherAccount === true } : {}),
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
  if (party !== "a") {
    if (row.mode !== "two_sided") return "not_party";
    const bound = respondentOf(row, bundle.invites, party).userId;
    if (!bound && !claimOk) return "not_party";
    if (!viewerId) return "signin_required";
    if (viewerId === row.ownerId) return "not_party";
    if (bound && bound !== viewerId) return "not_party";
  } else if (!viewerId || viewerId !== row.ownerId) {
    return viewerId ? "not_party" : "signin_required";
  }
  if (bundle.appeals.some((a) => a.status === "judging")) return "busy";
  if (bundle.appeals.some((a) => a.party === party && a.status === "judged")) return "appeal_used";
  return null;
}

export { excerptOf } from "@/lib/history-state";

export function caseSummary(r: CaseListRow, now: Date): CaseSummary {
  return {
    id: r.id,
    status: effectiveStatus(r, now),
    mode: r.mode,
    venue: r.venue,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    respondentAnswered: r.respondentAnswered,
    ...(r.sides > 2 && r.mode !== "one_sided" ? { parties: partiesFor(r.sides) } : {}),
    verdict: r.latestResult?.verdict ?? null,
    headline: r.removedAAt ? null : (r.latestResult?.headline ?? null),
    excerpt: r.removedAAt ? null : excerptOf(r.sideAStart),
    removed: r.removedAt !== null,
  };
}
