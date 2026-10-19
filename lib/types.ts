import { z } from "zod";

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

/** Aggregated result shown to the user and stored. Confidence is computed
 * from self-consistency (how often the judges agreed), never model-claimed. */
export const VerdictResult = JudgeOutput.extend({
  verdict: FinalVerdict,
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

export const FrameworkChoice = z.object({
  preset: z.string(),
  /** slider id -> 0..100 (50 = neutral). Omitted sliders count as neutral. */
  sliders: z.record(z.string(), z.number().min(0).max(100)).optional(),
});
export type FrameworkChoice = z.infer<typeof FrameworkChoice>;

export const VerdictRequest = z.object({
  argument: z.string().trim().min(20, "Tell us a bit more about the argument.").max(
    6000,
    "Keep it under 6000 characters.",
  ),
  framework: FrameworkChoice.default({ preset: "balanced" }),
  /** UI + judge output language. Stored as the result's `lang`. */
  lang: z.enum(["en", "tr"]).default("en"),
});
export type VerdictRequest = z.infer<typeof VerdictRequest>;

/** One replaced name, returned to the client only — never stored. */
export const NameMapping = z.object({
  original: z.string(),
  replacement: z.string(),
});
export type NameMapping = z.infer<typeof NameMapping>;

export const VerdictResponse = z.object({
  id: z.string(),
  result: VerdictResult,
  name_map: z.array(NameMapping),
});
export type VerdictResponse = z.infer<typeof VerdictResponse>;
