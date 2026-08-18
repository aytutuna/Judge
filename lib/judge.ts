import { frameworkInstruction } from "./frameworks";
import { geminiJson } from "./gemini";
import { JudgeOutput, type FrameworkChoice } from "./types";

/** Gemini responseSchema mirroring lib/types.ts JudgeOutput. */
const CLAIM = {
  type: "object",
  properties: {
    claim: { type: "string" },
    kind: { type: "string", enum: ["fact", "value", "definition", "logic"] },
  },
  required: ["claim", "kind"],
} as const;

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: ["side_a", "side_b", "split", "conditional", "dissolved"],
    },
    dispute_type: {
      type: "string",
      enum: ["factual", "logical", "definitional", "values", "mixed"],
    },
    headline: { type: "string" },
    crux: { type: "string" },
    split_points: {
      type: "array",
      nullable: true,
      items: {
        type: "object",
        properties: {
          party: { type: "string", enum: ["a", "b"] },
          point: { type: "string" },
        },
        required: ["party", "point"],
      },
    },
    conditional: {
      type: "array",
      nullable: true,
      items: {
        type: "object",
        properties: {
          if_value: { type: "string" },
          then: { type: "string" },
        },
        required: ["if_value", "then"],
      },
    },
    argument_map: {
      type: "object",
      properties: {
        side_a: { type: "array", items: CLAIM },
        side_b: { type: "array", items: CLAIM },
        bedrock_a: { type: "string" },
        bedrock_b: { type: "string" },
      },
      required: ["side_a", "side_b", "bedrock_a", "bedrock_b"],
    },
    facts_relied_on: { type: "array", items: { type: "string" } },
    losing_side_best_point: { type: "string" },
  },
  required: [
    "verdict",
    "dispute_type",
    "headline",
    "crux",
    "split_points",
    "conditional",
    "argument_map",
    "facts_relied_on",
    "losing_side_best_point",
  ],
} as const;

function systemPrompt(framework: FrameworkChoice, analyzeBFirst: boolean): string {
  return `You are Verdict, an impartial adjudicator of arguments between two parties.

METHOD — follow these steps in order:
1. STEELMAN: restate each side's position in its strongest form. One side being badly worded must not cost it the verdict. The description was written by one person; correct for their framing and give the absent side full strength.
2. CLASSIFY: break each side's case into its distinct claims (2-4 per side) and label each claim's kind: "fact" (checkable about the world), "value" (what matters or should be), "definition" (what a word means), "logic" (an inference from other claims).
3. BEDROCK: for each side, dig below its claims to the single deepest premise it ultimately rests on — a terminal value or a foundational factual belief. One short phrase each.
4. CRUX: state, in one sentence, the highest point where the two sides actually diverge. Everything above the crux is noise.
5. VERDICT — choose by what the crux is:
   - Crux is a checkable FACT or a LOGICAL error: pick the winner ("side_a" or "side_b"). List in facts_relied_on every factual claim your verdict depends on, so users can check them. Use only well-established knowledge; if the decisive fact is genuinely uncertain, do not pretend certainty — treat it as below.
   - Each side is right about a DIFFERENT part (one about the facts, the other about a consequence, or right about different sub-questions): return "split" and fill split_points with what each party is right about.
   - Crux is a clash of TERMINAL VALUES: apply the value framework below. If the framework clearly favors one side, pick that side and say in the crux that the call follows from the framework. If it does not clearly decide, return "conditional" and fill conditional with 2-3 "if you weight X highest -> then Y" branches.
   - The sides mean DIFFERENT THINGS by a key word and would agree once defined: return "dissolved".
6. HONESTY RULES: never manufacture certainty. Never rule against a side just because it was described less sympathetically. The narrator (usually Party A) gets no home advantage.

VALUE FRAMEWORK (set by the user): ${frameworkInstruction(framework)}

OUTPUT RULES:
- headline: at most 10 words, punchy, plain language, names the outcome.
- crux: one sentence, what this argument is REALLY about.
- All text concise and concrete — this is displayed on small cards.
- split_points only for "split" verdicts, otherwise null. conditional only for "conditional" verdicts, otherwise null.
- losing_side_best_point: the single strongest point of whichever side fares worse (for "conditional"/"dissolved", the best point that survives on the less-favored framing).
- facts_relied_on: empty array if the verdict rests on no contested facts.
${analyzeBFirst ? "\nPROCESS NOTE: analyze Party B's case fully before Party A's, to guard against order bias." : ""}`;
}

export type JudgeRun =
  | { ok: true; data: JudgeOutput }
  | { ok: false; blocked: boolean; error: string };

export async function judgeOnce(
  anonymizedArgument: string,
  framework: FrameworkChoice,
  opts: { analyzeBFirst?: boolean; temperature?: number } = {},
): Promise<JudgeRun> {
  const res = await geminiJson<unknown>({
    system: systemPrompt(framework, opts.analyzeBFirst ?? false),
    user: `THE ARGUMENT:\n\n${anonymizedArgument}`,
    schema: JUDGE_SCHEMA as unknown as Record<string, unknown>,
    temperature: opts.temperature ?? 0.7,
  });
  if (!res.ok) {
    return res.blocked
      ? { ok: false, blocked: true, error: `model refused (${res.reason})` }
      : { ok: false, blocked: false, error: res.error };
  }
  const parsed = JudgeOutput.safeParse(res.data);
  if (!parsed.success) {
    return { ok: false, blocked: false, error: `schema mismatch: ${parsed.error.message.slice(0, 200)}` };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Self-consistency: three independent runs (one analyzing B first as a
 * position-bias check). Confidence later derives from their agreement.
 * Runs are SEQUENTIAL on purpose: the Gemini free tier allows 5 requests/min
 * per model, and a concurrent burst trips it immediately.
 */
export async function judgeSelfConsistent(
  anonymizedArgument: string,
  framework: FrameworkChoice,
): Promise<JudgeRun[]> {
  // JUDGE_RUNS lets tight-quota deployments trade confidence for requests
  // (1-3; aggregate caps confidence when fewer runs survive).
  const n = Math.min(3, Math.max(1, Number(process.env.JUDGE_RUNS) || 3));
  const configs = [
    { temperature: 0.7 },
    { temperature: 0.7, analyzeBFirst: true },
    { temperature: 0.9 },
  ].slice(0, n);
  const runs: JudgeRun[] = [];
  for (const config of configs) {
    runs.push(await judgeOnce(anonymizedArgument, framework, config));
  }
  return runs;
}
