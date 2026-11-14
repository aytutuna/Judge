/** Two-sided cases, evidence and appeals: request schemas and response shapes
 * shared by the API, the website and the future mobile app. Pure module. */

import { z } from "zod";
import type { Entitlement } from "./account-types";
import type { Lang } from "./i18n";
import { DisplayNameInput, type OriginalStatus } from "./originals-types";
import {
  ArgumentText,
  RequestLang,
  type AppealOutcome,
  type EvidenceKind,
  type FinalVerdict,
  Tier,
  type NameMapping,
  type VerdictResult,
} from "./types";

export const CASE_EXPIRY_DAYS = 7;
export const MAX_CASE_SIDES = 4;
export const MAX_EVIDENCE_PER_SIDE = 3;
export const MAX_EVIDENCE_PER_APPEAL = 1;
export const MAX_IMAGES_PER_UPLOAD = 3;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
export const IMAGE_LONG_EDGE = 1600;
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MIN_APPEAL_CHARS = 20;
export const MAX_APPEAL_CHARS = 2000;
/** Rounds of added context a one-sided verdict takes (a case: one per party). */
export const MAX_VERDICT_APPEALS = 2;
export const CASE_POLL_MS = 3000;
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const EvidenceTokens = z.array(z.string().min(1).max(16_000));

export const CreateCaseRequest = z
  .object({
    /** Left out when the owner sends the link before writing: side A comes
     * later (POST /api/v1/cases/{id}/side). An empty string still fails. */
    text: ArgumentText.optional(),
    lang: RequestLang.default("en"),
    /** Ignored: every case holds one premium verdict. Older app builds
     * still send it. */
    tier: Tier.optional(),
    evidence: EvidenceTokens.max(MAX_EVIDENCE_PER_SIDE).optional(),
    /** How the owner appears on the case's share pages; empty or null = "Party A". */
    displayName: z.union([z.literal(""), DisplayNameInput]).nullable().optional(),
    /** 3 or 4 for a case with that many sides: B, C and D each get their own
     * invite link. Left out (or 2) is the usual case. */
    sides: z.number().int().min(2).max(MAX_CASE_SIDES).optional(),
    /** The scene the court is set in (lib/venues); anything not on the list is ignored. */
    venue: z.unknown().optional(),
  })
  .refine((v) => v.text !== undefined || !v.evidence?.length, {
    path: ["evidence"],
    message: "Images go with a written side.",
  });
export type CreateCaseRequest = z.infer<typeof CreateCaseRequest>;

/** POST /api/v1/cases/{id}/side: the owner writes side A after sending the link. */
export const SideRequest = z.object({
  text: ArgumentText,
  evidence: EvidenceTokens.max(MAX_EVIDENCE_PER_SIDE).optional(),
  displayName: z.union([z.literal(""), DisplayNameInput]).nullable().optional(),
});
export type SideRequest = z.infer<typeof SideRequest>;

export const RespondRequest = z.object({
  text: ArgumentText,
  evidence: EvidenceTokens.max(MAX_EVIDENCE_PER_SIDE).optional(),
  turnstileToken: z.string().max(2048).optional(),
  /** How the respondent appears on the case's share pages; empty or null = "Party B". */
  displayName: z.union([z.literal(""), DisplayNameInput]).nullable().optional(),
});
export type RespondRequest = z.infer<typeof RespondRequest>;

/** only_mine: judge side A alone. answered: with three or four sides, judge
 * the sides that answered (A, B and C... in order, at least two). */
export const JudgeNowRequest = z.object({ mode: z.enum(["only_mine", "answered"]).optional() });
export type JudgeNowRequest = z.infer<typeof JudgeNowRequest>;

export const AppealRequest = z.object({
  text: z
    .string()
    .trim()
    .min(MIN_APPEAL_CHARS, "Tell the judges a bit more.")
    .max(MAX_APPEAL_CHARS, `Keep it under ${MAX_APPEAL_CHARS} characters.`),
  evidence: EvidenceTokens.max(MAX_EVIDENCE_PER_APPEAL).optional(),
  /** Respondent only: the `respondent_claim` from answering signed out. */
  claim: z.string().max(64).optional(),
});
export type AppealRequest = z.infer<typeof AppealRequest>;

/** POST /api/v1/cases/{id}/claim: the `respondent_claim` from answering signed out. */
export const CaseClaimRequest = z.object({ claim: z.string().max(64) });

/** POST /api/v1/cases/{id}/invite: which side's link to replace (default b). */
export const RotateInviteRequest = z.object({ party: z.enum(["b", "c", "d"]).optional() });
export type RotateInviteRequest = z.infer<typeof RotateInviteRequest>;
export type CaseClaimRequest = z.infer<typeof CaseClaimRequest>;

export const EvidenceJsonUpload = z.object({
  images: z
    .array(z.object({ data: z.string().min(1), mediaType: z.string().max(64).optional() }))
    .min(1)
    .max(MAX_IMAGES_PER_UPLOAD),
});
export type EvidenceJsonUpload = z.infer<typeof EvidenceJsonUpload>;

export type EvidenceStatus = "ok" | "unreadable" | "refused" | "unsupported" | "too_large" | "failed";

export type EvidenceItemResult = {
  index: number;
  status: EvidenceStatus;
  kind: EvidenceKind | null;
  /** Signed token to send with a submission; null unless status is "ok". */
  token: string | null;
  /** The raw transcript (may contain real names), for the uploader's eyes only. */
  preview: string | null;
  expiresAt: string | null;
};

export type EvidenceUploadResponse = { items: EvidenceItemResult[] };

export type CaseStatus = "awaiting_respondent" | "judging" | "judged" | "failed" | "expired";
export type CaseMode = "two_sided" | "one_sided";
export type CaseRole = "owner" | "respondent";
export type PartyLetter = "a" | "b" | "c" | "d";
/** Clients that do not send SIDES_HEADER only ever see cases with 2 sides. */
/** Request header of a client that can show a case with three or four sides
 * ("Judge-Sides: 4"). Without it, such a case answers `update_required`
 * (and stays out of the case list), so an older app never shows a verdict or
 * a respond page it would mislabel. */
export const SIDES_HEADER = "Judge-Sides";
export type AppealStatus = "judging" | "judged" | "failed";
export type AppealBlock =
  | "signin_required"
  | "premium_required"
  | "no_credits"
  | "fair_use"
  | "appeal_used"
  | "appeal_limit"
  | "not_judged"
  | "busy"
  | "not_party"
  /** A one-sided verdict written signed out: keep it in the account first
   * (POST /api/v1/verdicts/{id}/claim). */
  | "claim_required";

export type CaseEvidenceView = { id: string; kind: EvidenceKind; transcript: string };

export type CaseSideView = {
  party: PartyLetter;
  /** Anonymized, as the judges read it. Empty once that party removed their side. */
  text: string;
  evidence: CaseEvidenceView[];
  submittedAt: string;
  /** That party removed their side: text and evidence are left out. */
  removed?: true;
};

export type CaseAppealView = {
  id: string;
  party: PartyLetter;
  status: AppealStatus;
  error: "quota" | "unavailable" | "refused" | null;
  text: string;
  evidence: CaseEvidenceView[];
  outcome: AppealOutcome | null;
  /** The verdict this appeal produced (share id), once judged. */
  verdictId: string | null;
  createdAt: string;
  /** That party removed their side: text and evidence are left out. */
  removed?: true;
};

export type CaseVerdictView = {
  seq: number;
  /** verdicts.id: share link /v/<id>, translate endpoint. */
  id: string;
  result: VerdictResult;
  appealId: string | null;
  createdAt: string;
  /** The signed-in viewer's own "Fair verdict?" answer. Absent when signed out. */
  rating?: "up" | "down" | null;
};

/** One invited side as the owner sees it. */
export type CaseInviteView = {
  party: PartyLetter;
  status: "waiting" | "answered" | "closed";
  /** The owner's link for this side while it waits; null once answered or closed. */
  inviteUrl: string | null;
  answeredAt: string | null;
};

/** Where one invited side stands, live: not opened, opened (took the side),
 * typing now (a heartbeat in the last few seconds), or answered. */
export type LiveState = "waiting" | "opened" | "typing" | "answered";
export type CaseLiveSide = {
  party: "b" | "c" | "d";
  state: LiveState;
  /** The name that side chose for itself, once it has answered. */
  name?: string;
};

export type CaseView = {
  id: string;
  role: CaseRole;
  yourParty: PartyLetter;
  status: CaseStatus;
  mode: CaseMode | null;
  /** "free" only on cases created before every verdict was premium: they
   * hold no unit. */
  tier: Tier;
  lang: Lang;
  /** The scene the court is set in, chosen when the case was created; null for
   * cases from before venues, which show the street court. */
  venue?: string | null;
  createdAt: string;
  expiresAt: string;
  judgedAt: string | null;
  respondentAnswered: boolean;
  /** Only with three or four sides: A to C or A to D. */
  parties?: PartyLetter[];
  /** Only with three or four sides, for the owner: side B to D with their
   * links and whether they answered. `inviteUrl` below stays side B's. */
  invites?: CaseInviteView[];
  /** Owner only: each invited side's live state. Absent for a respondent. */
  live?: CaseLiveSide[];
  /** Owner only: a new link can still be made (some side has no seat yet). */
  canRotate?: boolean;
  /** Owner only, while a side is still open: the one link for everyone.
   * Every entry of `invites` carries the same URL for older apps. */
  inviteUrl: string | null;
  /** Respondent role only: the signed-in viewer is the case owner. */
  ownInvite: boolean;
  /** Your own side always (once submitted); the other side only after a two-sided verdict. */
  sides: CaseSideView[];
  /** Oldest first; the last one is current. */
  verdicts: CaseVerdictView[];
  appeals: CaseAppealView[];
  canJudgeNow: boolean;
  /** Only with three or four sides, owner: the answers in so far are enough
   * to judge without the rest (POST .../judge { "mode": "answered" }). */
  canJudgeAnswered?: boolean;
  /** The case has no side A yet (the owner sent the link before writing)
   * and nothing was removed. */
  ownerSideMissing: boolean;
  appeal: { allowed: boolean; blockedBy: AppealBlock | null };
  lastError: "quota" | "unavailable" | null;
  /** Poll GET again after this many ms while something is judging; null otherwise. */
  pollAfterMs: number | null;
  /** The viewer's own name map (their side and appeal, merged), from the
   * server's encrypted copy; null when none is stored (older cases, no key)
   * or the viewer is not proven to be that party. */
  names: NameMapping[] | null;
  /** The names each party chose for the share pages, and the owner's switch. */
  display: { namesVisible: boolean; a: string | null; b: string | null; c?: string | null; d?: string | null };
  /** Set once a party removed their side: every link of the case is closed. */
  removed: { at: string; parties: PartyLetter[] } | null;
  /** Status of the viewer's own side original. */
  yourOriginal: OriginalStatus;
  /** Respondent role: side B is linked to the signed-in account, so the case
   * is on its Verdicts list. False for an answer kept only by this
   * browser's claim (POST /api/v1/cases/{id}/claim links it). */
  inAccount?: boolean;
  /** Respondent role, for a request carrying the claim: side B is linked to
   * an account other than the viewer's (answered signed in, or kept), so
   * this browser neither lists the case nor offers to keep it. */
  inOtherAccount?: boolean;
};

export type CaseSummary = {
  id: string;
  status: CaseStatus;
  mode: CaseMode | null;
  venue?: string | null;
  createdAt: string;
  expiresAt: string;
  respondentAnswered: boolean;
  /** Only with three or four sides. */
  parties?: PartyLetter[];
  /** Latest verdict, anonymized. */
  verdict: FinalVerdict | null;
  headline: string | null;
  /** The first words of your side, anonymized: a title before any verdict. */
  excerpt: string | null;
  /** A side was removed: the case's links are closed. */
  removed: boolean;
};

export type CreateCaseResponse = {
  case: CaseView;
  name_map: NameMapping[];
  entitlement?: Entitlement;
  replayed?: boolean;
};
export type SideResponse = CreateCaseResponse;
export type CaseResponse = { case: CaseView };
export type CaseListResponse = { cases: CaseSummary[]; next: string | null };
export type RespondResponse = {
  case: CaseView;
  name_map: NameMapping[];
  /** Present when the answer was sent signed out: proof of having written
   * side B. Keep it with the name map; send it as `claim` on
   * POST /respond/{token}/appeals and as the `Respondent-Claim` header on
   * GET /respond/{token}. Without it (or the account that answered), nobody
   * can add context as Party B. */
  respondent_claim?: string;
  replayed?: boolean;
};
export type AppealResponse = {
  case: CaseView;
  name_map: NameMapping[];
  entitlement?: Entitlement;
  replayed?: boolean;
};
/** POST /api/v1/respond/{token}/open: the opener takes the next open side.
 * The claim secret goes back as Respondent-Claim from then on. */
export type OpenResponse = { case: CaseView; respondent_claim: string | null };
/** GET /api/v1/cases/live: the owner's cases that wait on someone. */
export type LiveCasesResponse = { cases: { id: string; sides: CaseLiveSide[] }[] };
export type InviteResponse = { inviteUrl: string; party?: PartyLetter };
/** DELETE /api/v1/cases/{id}: kept for older clients; it runs the owner's
 * removal (nothing is deleted). */
export type DeleteCaseResponse = { deleted: true; removed: true; removedAt: string };
/** POST /api/v1/cases/{id}/removal and /respond/{token}/removal */
export type CaseRemovalResponse = { removed: true; removedAt: string; case: CaseView };
/** POST /api/v1/cases/{id}/claim */
export type CaseClaimResponse = { claimed: true };
