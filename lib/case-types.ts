/** Two-sided cases, evidence and appeals: request schemas and response shapes
 * shared by the API, the website and the future mobile app. Pure module. */

import { z } from "zod";
import type { Entitlement } from "./account-types";
import type { Lang } from "./i18n";
import { DisplayNameInput, type OriginalStatus } from "./originals-types";
import {
  ArgumentText,
  type AppealOutcome,
  type EvidenceKind,
  type FinalVerdict,
  Tier,
  type NameMapping,
  type VerdictResult,
} from "./types";

export const CASE_EXPIRY_DAYS = 7;
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

export const CreateCaseRequest = z.object({
  text: ArgumentText,
  lang: z.enum(["en", "tr"]).default("en"),
  /** Ignored: every case holds one premium verdict. Older app builds
   * still send it. */
  tier: Tier.optional(),
  evidence: EvidenceTokens.max(MAX_EVIDENCE_PER_SIDE).optional(),
  /** How the owner appears on the case's share pages; empty or null = "Party A". */
  displayName: z.union([z.literal(""), DisplayNameInput]).nullable().optional(),
});
export type CreateCaseRequest = z.infer<typeof CreateCaseRequest>;

export const RespondRequest = z.object({
  text: ArgumentText,
  evidence: EvidenceTokens.max(MAX_EVIDENCE_PER_SIDE).optional(),
  turnstileToken: z.string().max(2048).optional(),
  /** How the respondent appears on the case's share pages; empty or null = "Party B". */
  displayName: z.union([z.literal(""), DisplayNameInput]).nullable().optional(),
});
export type RespondRequest = z.infer<typeof RespondRequest>;

export const JudgeNowRequest = z.object({ mode: z.literal("only_mine").optional() });
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
export type PartyLetter = "a" | "b";
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
  createdAt: string;
  expiresAt: string;
  judgedAt: string | null;
  respondentAnswered: boolean;
  /** Owner only, while awaiting the respondent. */
  inviteUrl: string | null;
  /** Respondent role only: the signed-in viewer is the case owner. */
  ownInvite: boolean;
  /** Your own side always (once submitted); the other side only after a two-sided verdict. */
  sides: CaseSideView[];
  /** Oldest first; the last one is current. */
  verdicts: CaseVerdictView[];
  appeals: CaseAppealView[];
  canJudgeNow: boolean;
  appeal: { allowed: boolean; blockedBy: AppealBlock | null };
  lastError: "quota" | "unavailable" | null;
  /** Poll GET again after this many ms while something is judging; null otherwise. */
  pollAfterMs: number | null;
  /** The viewer's own name map (their side and appeal, merged), from the
   * server's encrypted copy; null when none is stored (older cases, no key)
   * or the viewer is not proven to be that party. */
  names: NameMapping[] | null;
  /** The names each party chose for the share pages, and the owner's switch. */
  display: { namesVisible: boolean; a: string | null; b: string | null };
  /** Set once a party removed their side: every link of the case is closed. */
  removed: { at: string; parties: PartyLetter[] } | null;
  /** Status of the viewer's own side original. */
  yourOriginal: OriginalStatus;
};

export type CaseSummary = {
  id: string;
  status: CaseStatus;
  mode: CaseMode | null;
  createdAt: string;
  expiresAt: string;
  respondentAnswered: boolean;
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
export type InviteResponse = { inviteUrl: string };
/** DELETE /api/v1/cases/{id}: kept for older clients; it runs the owner's
 * removal (nothing is deleted). */
export type DeleteCaseResponse = { deleted: true; removed: true; removedAt: string };
/** POST /api/v1/cases/{id}/removal and /respond/{token}/removal */
export type CaseRemovalResponse = { removed: true; removedAt: string; case: CaseView };
