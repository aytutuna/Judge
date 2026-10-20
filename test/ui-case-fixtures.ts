/** Case views and verdicts shaped exactly like the /api/v1 case endpoints
 * return them (lib/case-types.ts), for UI tests and screenshots. */

import type { CaseView, CaseVerdictView } from "../lib/case-types";
import type { NameMapping, VerdictResult } from "../lib/types";

export const OWNER_NAMES: NameMapping[] = [
  { original: "I", replacement: "Party A" },
  { original: "Deniz", replacement: "Party B" },
  { original: "Sarah", replacement: "Person C" },
];

export const RESPONDENT_NAMES: NameMapping[] = [
  { original: "I", replacement: "Party B" },
  { original: "Aytu", replacement: "Party A" },
  { original: "Sarah", replacement: "Person C" },
];

export const TWO_SIDED_RESULT: VerdictResult = {
  verdict: "side_b",
  dispute_type: "factual",
  headline: "Party B paid the April bill, so it was Party A's turn",
  crux: "Whether Party B's transfer on April 3 was the electricity bill.",
  split_points: null,
  conditional: null,
  argument_map: {
    side_a: [{ claim: "Party A says the bill was Party B's turn this month.", kind: "fact" }],
    side_b: [{ claim: "Party B says they paid in April and shows the transfer.", kind: "fact" }],
    bedrock_a: "Turns should be kept as agreed.",
    bedrock_b: "A receipt settles who paid.",
  },
  facts_relied_on: ["The bill is split by month."],
  losing_side_best_point: "Party A kept the shared calendar up to date.",
  confidence: 4,
  runs: ["side_b", "side_b", "side_a"],
  demo: false,
  lang: "en",
  tier: "premium",
  panel: { models: ["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
  two_sided: true,
  agreed_facts: ["They split the electricity bill by month.", "Person C reminded them on April 1."],
  disputed_facts: [
    {
      fact: "Who paid the April bill",
      party_a: "Party B never paid in April",
      party_b: "Party B paid on April 3",
      finding: "b",
      decisive: true,
    },
    {
      fact: "Whether the turn order changed in March",
      party_a: "It stayed the same",
      party_b: "They swapped months in March",
      finding: "unsettled",
      decisive: false,
    },
  ],
  would_change: ["A bank record showing Party A paid in April", "A message agreeing to swap months"],
  evidence_used: { a: 1, b: 2 },
};

export const APPEAL_RESULT: VerdictResult = {
  ...TWO_SIDED_RESULT,
  verdict: "split",
  headline: "Both have a point once the March swap is in",
  confidence: 3,
  runs: ["split", "split", "side_b"],
  lean: { party: "b", unanimous: false, reason: "The transfer still counts." },
  appeal: {
    by: "a",
    outcome: "changed",
    previous_id: "v_first",
    previous_verdict: "side_b",
    previous_confidence: 4,
    confidence_change: -1,
    summary: "Party A's screenshot of the March swap made the turn order unclear.",
  },
};

const ISO = "2026-10-20T09:00:00.000Z";
const EXPIRES = "2026-10-27T09:00:00.000Z";

export function verdictView(result: VerdictResult, seq = 1, id = `v${seq}`, appealId: string | null = null): CaseVerdictView {
  return { seq, id, result, appealId, createdAt: ISO };
}

const SIDE_A = {
  party: "a" as const,
  text: "Party A: It was Party B's turn to pay the electricity bill this month. Party B says they paid, but I never saw it.",
  evidence: [
    {
      id: "e1",
      kind: "chat" as const,
      transcript: '[Chat screenshot · "Party B"]\n21:02 Party A: Did you pay the electricity bill?\n21:05 Party B: No, it was your turn',
    },
  ],
  submittedAt: ISO,
};

const SIDE_B = {
  party: "b" as const,
  text: "Party B: I paid on April 3 by transfer. We swapped months in March because Party A was away.",
  evidence: [],
  submittedAt: ISO,
};

export function caseView(over: Partial<CaseView> = {}): CaseView {
  return {
    id: "case123",
    role: "owner",
    yourParty: "a",
    status: "awaiting_respondent",
    mode: null,
    lang: "en",
    framework: { preset: "balanced" },
    createdAt: ISO,
    expiresAt: EXPIRES,
    judgedAt: null,
    respondentAnswered: false,
    inviteUrl: "https://settle.example/r/AbCdEfGhIjKlMnOpQrStUv",
    ownInvite: false,
    sides: [SIDE_A],
    verdicts: [],
    appeals: [],
    canJudgeNow: true,
    appeal: { allowed: false, blockedBy: "not_judged" },
    lastError: null,
    pollAfterMs: null,
    names: null,
    display: { namesVisible: true, a: null, b: null },
    removed: null,
    yourOriginal: "not_stored",
    ...over,
  };
}

export const OWNER = {
  awaiting: caseView(),
  judging: caseView({
    status: "judging",
    mode: "two_sided",
    respondentAnswered: true,
    inviteUrl: null,
    canJudgeNow: false,
    pollAfterMs: 3000,
  }),
  judged: caseView({
    status: "judged",
    mode: "two_sided",
    respondentAnswered: true,
    inviteUrl: null,
    canJudgeNow: false,
    judgedAt: ISO,
    sides: [SIDE_A, SIDE_B],
    verdicts: [verdictView(TWO_SIDED_RESULT)],
    appeal: { allowed: true, blockedBy: null },
  }),
  appealed: caseView({
    status: "judged",
    mode: "two_sided",
    respondentAnswered: true,
    inviteUrl: null,
    canJudgeNow: false,
    judgedAt: ISO,
    sides: [SIDE_A, SIDE_B],
    verdicts: [verdictView(TWO_SIDED_RESULT, 1, "v_first"), verdictView(APPEAL_RESULT, 2, "v_second", "ap1")],
    appeals: [
      {
        id: "ap1",
        party: "a",
        status: "judged",
        error: null,
        text: "Party A: Here is the message where we agreed to swap months in March.",
        evidence: [],
        outcome: "changed",
        verdictId: "v_second",
        createdAt: ISO,
      },
    ],
    appeal: { allowed: false, blockedBy: "appeal_used" },
  }),
  failed: caseView({
    status: "failed",
    mode: "two_sided",
    respondentAnswered: true,
    inviteUrl: null,
    canJudgeNow: false,
    lastError: "unavailable",
  }),
  expired: caseView({ status: "expired", inviteUrl: null, canJudgeNow: true }),
};

const respondentBase: Partial<CaseView> = {
  role: "respondent",
  yourParty: "b",
  inviteUrl: null,
  canJudgeNow: false,
  sides: [],
};

export const RESPONDENT = {
  form: caseView({ ...respondentBase }),
  ownInvite: caseView({ ...respondentBase, ownInvite: true }),
  judging: caseView({
    ...respondentBase,
    status: "judging",
    mode: "two_sided",
    respondentAnswered: true,
    sides: [SIDE_B],
    pollAfterMs: 3000,
  }),
  judgedSignedOut: caseView({
    ...respondentBase,
    status: "judged",
    mode: "two_sided",
    respondentAnswered: true,
    judgedAt: ISO,
    sides: [SIDE_A, SIDE_B],
    verdicts: [verdictView(TWO_SIDED_RESULT)],
    appeal: { allowed: false, blockedBy: "signin_required" },
  }),
  judgedPremium: caseView({
    ...respondentBase,
    status: "judged",
    mode: "two_sided",
    respondentAnswered: true,
    judgedAt: ISO,
    sides: [SIDE_A, SIDE_B],
    verdicts: [verdictView(TWO_SIDED_RESULT)],
    appeal: { allowed: true, blockedBy: null },
  }),
  withoutYou: caseView({
    ...respondentBase,
    status: "judged",
    mode: "one_sided",
    verdicts: [],
  }),
  expired: caseView({ ...respondentBase, status: "expired" }),
};
