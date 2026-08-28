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

/** Aggregated result shown to the user and stored. Confidence is computed
 * from self-consistency (how often the judges agreed), never model-claimed. */
export const VerdictResult = JudgeOutput.extend({
  verdict: FinalVerdict,
  confidence: z.number().int().min(1).max(5),
  /** Which verdict each self-consistency run reached, for transparency. */
  runs: z.array(JudgeVerdict),
  /** True when produced by demo mode (no API key configured). */
  demo: z.boolean(),
  /** True when the model itself declined to judge (its safety filter). */
  model_refused: z.boolean().optional(),
});
export type VerdictResult = z.infer<typeof VerdictResult>;

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
