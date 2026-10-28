import { z } from "zod";
import type { Entitlement } from "./account-types";

export const ClaimKind = z.enum(["fact", "value", "definition", "logic"]);
export type ClaimKind = z.infer<typeof ClaimKind>;

export const DisputeType = z.enum([
  "factual",
  "logical",
  "definitional",
  "values",
  "mixed",
]);
export type DisputeType = z.infer<typeof DisputeType>;

/** What a single judge run may conclude. "too_close" is never produced by a
 * run — it only emerges from aggregation when runs disagree. */
export const JudgeVerdict = z.enum([
  "side_a",
  "side_b",
  "split",
  "conditional",
  "dissolved",
]);
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;

export const FinalVerdict = z.enum([
  "side_a",
  "side_b",
  "split",
  "conditional",
  "dissolved",
  "too_close",
]);
export type FinalVerdict = z.infer<typeof FinalVerdict>;

export const Claim = z.object({
  claim: z.string(),
  kind: ClaimKind,
});
export type Claim = z.infer<typeof Claim>;

export const ArgumentMap = z.object({
  side_a: z.array(Claim).min(1),
  side_b: z.array(Claim).min(1),
  bedrock_a: z.string(),
  bedrock_b: z.string(),
});
export type ArgumentMap = z.infer<typeof ArgumentMap>;

/** Output schema for one structured judge call. */
export const JudgeOutput = z.object({
  verdict: JudgeVerdict,
  dispute_type: DisputeType,
  headline: z.string(),
  /** What decided it, in a few plain sentences. */
  why: z.string(),
  crux: z.string(),
  split_points: z
    .array(z.object({ party: z.enum(["a", "b"]), point: z.string() }))
    .nullable(),
  conditional: z
    .array(z.object({ if_value: z.string(), then: z.string() }))
    .nullable(),
  argument_map: ArgumentMap,
  facts_relied_on: z.array(z.string()),
  losing_side_best_point: z.string(),
});
export type JudgeOutput = z.infer<typeof JudgeOutput>;

export const JudgeVerdictSide = z.enum(["side_a", "side_b"]);
export type JudgeVerdictSide = z.infer<typeof JudgeVerdictSide>;

/** What one judge run actually emits: the honest verdict plus the forced
 * ruling. The two lean fields sit LAST on purpose, mirroring their position
 * in JUDGE_SCHEMA (lib/judge.ts) — the ordering is an anchoring guard: the
 * verdict is fully emitted before the forced choice exists. */
export const JudgeRunOutput = JudgeOutput.extend({
  leaning: JudgeVerdictSide,
  leaning_reason: z.string(),
});
export type JudgeRunOutput = z.infer<typeof JudgeRunOutput>;

/** Forced ruling attached to non-winner verdicts: which side the judges,
 * forced to pick, found MORE right. Computed from run agreement, never
 * model-claimed as an aggregate. */
export const Lean = z.object({
  party: z.enum(["a", "b"]),
  unanimous: z.boolean(),
  reason: z.string(),
  /** Forced votes for / against the leaned side. Only stored when the run
   * count does not imply it (non-unanimous with 4+ runs); absent means
   * (runs - 1)–1 or unanimous. */
  tally: z.object({ for: z.number().int(), against: z.number().int() }).optional(),
});
export type Lean = z.infer<typeof Lean>;

export const CruxTrialOutcome = z.enum(["survived", "overturned", "uncertain"]);
export type CruxTrialOutcome = z.infer<typeof CruxTrialOutcome>;

/** Result of the adversarial cross-examination of a fact/logic winner ruling. */
export const CruxTrial = z.object({
  attack: z.string(),
  outcome: CruxTrialOutcome,
  /** Adjudicator's short reason (empty string when the attacker conceded). */
  reasoning: z.string(),
});
export type CruxTrial = z.infer<typeof CruxTrial>;

// --- Premium ------------------------------------------------------------------
export const Tier = z.enum(["free", "premium"]);
export type Tier = z.infer<typeof Tier>;

export const FactStatus = z.enum(["supported", "refuted", "mixed", "unverified"]);
export type FactStatus = z.infer<typeof FactStatus>;

export const FactSource = z.object({ title: z.string(), url: z.string() });
export type FactSource = z.infer<typeof FactSource>;

export const FactClaim = z.object({
  claim: z.string(),
  status: FactStatus,
  summary: z.string(),
  sources: z.array(FactSource),
});
export type FactClaim = z.infer<typeof FactClaim>;

/** "checked": web-checked claims below; "none": nothing checkable (values,
 * meanings, taste), no search was run; "unavailable": the fact-check failed or
 * timed out and the judges ruled without it. */
export const FactCheck = z.object({
  status: z.enum(["checked", "none", "unavailable"]),
  claims: z.array(FactClaim),
});
export type FactCheck = z.infer<typeof FactCheck>;

/** models[i] is the model that produced runs[i]. */
export const Panel = z.object({ models: z.array(z.string()) });
export type Panel = z.infer<typeof Panel>;

// --- Two-sided cases, evidence, appeals ------------------------------------------
export const EvidenceKind = z.enum(["chat", "document", "photo", "other"]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const DisputedFact = z.object({
  fact: z.string(),
  party_a: z.string(),
  party_b: z.string(),
  finding: z.enum(["a", "b", "unsettled"]),
  decisive: z.boolean(),
});
export type DisputedFact = z.infer<typeof DisputedFact>;

export const EvidenceUsed = z.object({ a: z.number().int().min(0), b: z.number().int().min(0) });
export type EvidenceUsed = z.infer<typeof EvidenceUsed>;

export const AppealOutcome = z.enum(["upheld", "overturned", "changed"]);
export type AppealOutcome = z.infer<typeof AppealOutcome>;

/** On a verdict produced by an appeal: how it compares to the one before. */
export const AppealInfo = z.object({
  by: z.enum(["a", "b"]),
  outcome: AppealOutcome,
  previous_id: z.string(),
  previous_verdict: FinalVerdict,
  previous_confidence: z.number().int().min(1).max(5),
  confidence_change: z.number().int(),
  summary: z.string(),
});
export type AppealInfo = z.infer<typeof AppealInfo>;

/** Context the writer added to a one-sided verdict. Its id is also the id
 * of the verdict it produces: poll GET /api/v1/verdicts/{id} for it. */
export type VerdictAppealView = {
  id: string;
  status: "judging" | "judged" | "failed";
  error: "quota" | "unavailable" | "refused" | null;
  outcome: AppealOutcome | null;
  /** The verdict it answered: the first one, or the previous appeal's. */
  baseId: string;
  createdAt: string;
  /** The writer only: the context as the judges read it (anonymized). */
  text?: string;
};

/** One judge run on a two-sided case (lib/judge.ts TWO_SIDED_JUDGE_SCHEMA). */
export const TwoSidedJudgeRunOutput = JudgeRunOutput.extend({
  agreed_facts: z.array(z.string()),
  disputed_facts: z.array(DisputedFact),
  would_change: z.array(z.string()),
});
export type TwoSidedJudgeRunOutput = z.infer<typeof TwoSidedJudgeRunOutput>;

/** Aggregated result shown to the user and stored. Confidence is computed
 * from self-consistency (how often the judges agreed), never model-claimed. */
export const VerdictResult = JudgeOutput.extend({
  verdict: FinalVerdict,
  /** Optional so rows stored before it existed keep parsing. Also absent on
   * refusals and "too_close" verdicts. */
  why: z.string().optional(),
  confidence: z.number().int().min(1).max(5),
  /** Which verdict each self-consistency run reached, for transparency. */
  runs: z.array(JudgeVerdict),
  /** Legacy: true on verdicts stored by the removed demo mode. Never set anymore. */
  demo: z.boolean(),
  /** True when the model itself declined to judge (its safety filter). */
  model_refused: z.boolean().optional(),
  /** Adversarial cross-examination of a fact/logic winner ruling (absent when
   * the trial was skipped, failed open, or predates the feature). */
  crux_trial: CruxTrial.optional(),
  /** Forced ruling for non-winner verdicts. Optional so every previously
   * stored row keeps parsing: absent (undefined) for side_a/side_b winners,
   * refusals, and pre-feature rows; null only for a computed lean tie. */
  lean: Lean.nullable().optional(),
  /** True when the first verdict was low-confidence and extra judges were
   * called in (their votes are in `runs`). Absent on everything else. */
  escalated: z.boolean().optional(),
  /** Language the free text is written in: the judging language, or the
   * target language of a stored translation. Optional so rows written before
   * it existed keep parsing; those fall back to verdictLang's heuristic. */
  lang: z.enum(["en", "tr"]).optional(),
  /** "premium" on premium verdicts; absent on free (and all older) rows. */
  tier: Tier.optional(),
  /** Web fact-check run before judging (premium only). */
  fact_check: FactCheck.optional(),
  /** Which model produced each run (premium only). */
  panel: Panel.optional(),
  /** Two-sided case verdicts only. */
  two_sided: z.literal(true).optional(),
  agreed_facts: z.array(z.string()).optional(),
  disputed_facts: z.array(DisputedFact).optional(),
  would_change: z.array(z.string()).optional(),
  /** Images each party attached (premium with evidence, and cases). */
  evidence_used: EvidenceUsed.optional(),
  /** Set on verdicts produced by an appeal. */
  appeal: AppealInfo.optional(),
});
export type VerdictResult = z.infer<typeof VerdictResult>;

/** POST /api/verdict/[id]/translate success body. `result` is the original
 * when `translated` is false (the verdict was already in `lang`). */
export const TranslateResponse = z.object({
  id: z.string(),
  lang: z.enum(["en", "tr"]),
  source: z.enum(["en", "tr"]),
  translated: z.boolean(),
  result: VerdictResult,
});
export type TranslateResponse = z.infer<typeof TranslateResponse>;

export const ArgumentText = z.string().trim().min(20, "Tell us a bit more about the argument.").max(
  6000,
  "Keep it under 6000 characters.",
);

export const Clarification = z.object({
  question: z.string().trim().min(1).max(300),
  /** Empty string = skipped; skipped answers are dropped server-side. */
  answer: z.string().trim().max(500),
});
export type Clarification = z.infer<typeof Clarification>;

export const VerdictRequest = z.object({
  argument: ArgumentText,
  // Older app builds still send a judging style as `framework`; zod strips unknown keys.
  /** UI + judge output language. Stored as the result's `lang`. */
  lang: z.enum(["en", "tr"]).default("en"),
  /** Ignored: every verdict is premium. Older app builds still send it. */
  tier: Tier.optional(),
  /** Answers to the clarifying questions. */
  clarifications: z.array(Clarification).max(2).optional(),
  /** Signed evidence tokens from POST /api/v1/evidence. */
  evidence: z.array(z.string().min(1).max(16_000)).max(3).optional(),
});
export type VerdictRequest = z.infer<typeof VerdictRequest>;

export const ClarifyRequest = z.object({
  argument: ArgumentText,
  lang: z.enum(["en", "tr"]).default("en"),
});
export type ClarifyRequest = z.infer<typeof ClarifyRequest>;

export const ClarifyResponse = z.object({
  questions: z.array(z.object({ id: z.string(), text: z.string() })).max(2),
});
export type ClarifyResponse = z.infer<typeof ClarifyResponse>;

/** One replaced name. Returned to the writer; stored only inside the
 * writer's encrypted original (lib/originals), never in the clear. */
export const NameMapping = z.object({
  original: z.string(),
  replacement: z.string(),
});
export type NameMapping = z.infer<typeof NameMapping>;

/** What the share page shows instead of the labels (null = the label). */
export const DisplayStateSchema = z.object({
  namesVisible: z.boolean(),
  a: z.string().nullable(),
  b: z.string().nullable(),
  others: z.record(z.string(), z.string()),
});

export const VerdictResponse = z.object({
  id: z.string(),
  result: VerdictResult,
  name_map: z.array(NameMapping),
  /** Signed-out writers only, returned once: keep it (web: localStorage
   * "judge.owner.<id>"; mobile: secure storage) and send it as the
   * X-Owner-Token header to see the original, change names or remove it. */
  owner_token: z.string().optional(),
  /** Whether the original and the names were stored (false: no key on the server). */
  originals_stored: z.boolean().optional(),
  /** The share page's names right now. */
  display: DisplayStateSchema.optional(),
  /** A first-name suggestion for the writer's own display name (signed in). */
  suggested_display_a: z.string().nullable().optional(),
});
export type VerdictResponse = z.infer<typeof VerdictResponse>;

/** POST /api/v1/verdict body. Free responses are exactly VerdictResponse;
 * premium adds the updated entitlement, and `replayed` marks an
 * Idempotency-Key replay of an already-finished verdict (name_map is [] then). */
export type VerdictApiResponse = VerdictResponse & { entitlement?: Entitlement; replayed?: boolean };

/** GET /api/v1/verdicts/{id}. The stored input text is never exposed.
 * `display`: the names the share page shows (null = the labels). */
export type StoredVerdictResponse = {
  id: string;
  result: VerdictResult;
  createdAt: string;
  display?: { a: string | null; b: string | null; others: Record<string, string> } | null;
  /** A one-sided verdict's added context, oldest first. The verdict of the
   * last judged one is the current ruling. */
  appeals?: VerdictAppealView[];
};
