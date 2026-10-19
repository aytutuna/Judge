import { frameworkInstruction } from "./frameworks";
import { claudeJson, type Effort } from "./claude";
import { humanStyle } from "./style";
import type { Lang } from "./i18n";
import { JudgeRunOutput, type FrameworkChoice } from "./types";

/** Output schema mirroring lib/types.ts JudgeOutput (compact form,
 * converted by toClaudeSchema in lib/claude.ts). */
const CLAIM = {
  type: "object",
  properties: {
    claim: { type: "string" },
    kind: { type: "string", enum: ["fact", "value", "definition", "logic"] },
  },
  required: ["claim", "kind"],
} as const;

export const JUDGE_SCHEMA = {
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
    // Ordering is the anchoring guard: the verdict is fully emitted before
    // the forced choice exists. Structured outputs emit JSON in schema
    // declaration order (toClaudeSchema preserves it) and generation is
    // autoregressive, so `leaning`/`leaning_reason` MUST stay the LAST two
    // properties (and last in `required`) — never alphabetize or reorder
    // them, or the forced pick could anchor the verdict toward side_a/side_b.
    // Adaptive thinking runs before the JSON, so this orders the emitted
    // answer only; step 5b's "must NOT change your verdict" covers reasoning.
    leaning: { type: "string", enum: ["side_a", "side_b"] },
    leaning_reason: { type: "string" },
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
    "leaning",
    "leaning_reason",
  ],
} as const;

/** Appended when the request asks for Turkish output, ahead of the Turkish
 * voice block (lib/style.ts). The register and if_value-shape sentences are
 * load-bearing: without them the model defaults to formal "siz" (clashing
 * with the all-"sen" UI on the same card) and emits indicative or
 * self-prefixed conditionals that break the "Eğer … → …" card. The register
 * is repeated in the voice block; it stays here so editing the shared voice
 * can never drop it. */
const TR_LANGUAGE_BLOCK = `

LANGUAGE: Write every free-text output field (headline, crux, claims, bedrock premises, split points, conditional branches, facts_relied_on, losing_side_best_point, leaning_reason) in Turkish, following the VOICE rules below. Address the reader with informal "sen", never "siz". Refer to the parties as "Taraf A" and "Taraf B" in prose. Write each conditional if_value as a bare conditional clause ending in -sa/-se (e.g. "dürüstlüğe en çok değer veriyorsan"), with no leading "Eğer". Keep all JSON enum values exactly as specified in the schema (English identifiers). headline stays at most 10 words.`;

function systemPrompt(framework: FrameworkChoice, analyzeBFirst: boolean, lang: Lang): string {
  return `You are Verdict, an impartial adjudicator of arguments between two parties.

METHOD — follow these steps in order:
1. STEELMAN: restate each side's position in its strongest form. One side being badly worded must not cost it the verdict. The description was written by one person; correct for their framing and give the absent side full strength.
2. CLASSIFY: break each side's case into its distinct claims (2-4 per side) and label each claim's kind: "fact" (checkable about the world), "value" (what matters or should be), "definition" (what a word means), "logic" (an inference from other claims).
3. BEDROCK: for each side, dig below its claims to the single deepest premise it ultimately rests on — a terminal value or a foundational factual belief. One short phrase each.
4. CRUX: state, in one sentence, the highest point where the two sides actually diverge. Everything above the crux is noise.
5. VERDICT — people come here to find out who is right. Naming a winner ("side_a" or "side_b") is the DEFAULT; "split", "conditional" and "dissolved" are exceptions you must earn. Before returning one of them, ask: "If I had to rule, would I know which side to rule for?" If yes, rule for that side — a winner verdict can still acknowledge the other side's best point (losing_side_best_point exists for that). Choose by what the crux is:
   - Crux is a checkable FACT or a LOGICAL error: pick the winner. List in facts_relied_on every factual claim your verdict depends on, so users can check them. Use only well-established knowledge. If the decisive fact is not settled but the evidence clearly favors one side, pick that side; only a genuine evidential toss-up falls through to the exceptions below.
   - Crux is a clash of TERMINAL VALUES: apply the value framework below. If it favors one side — even moderately — pick that side and make clear in the crux, in everyday words, that this comes down to which priority matters more and which one tips it. Return "conditional" (with 2-3 "if you weight X highest -> then Y" branches) ONLY when the framework is genuinely balanced between the two sides.
   - Crux is what a key WORD means: if one side's usage matches how the word is ordinarily used in this context, that side wins — rule like a court reading a contract. Return "dissolved" ONLY when both usages are fully standard and the parties would have nothing left to disagree about once the word is defined.
   - Each side is right about a DIFFERENT part: if one side is right about the part the argument is centrally about, that side wins. Return "split" (filling split_points with what each party is right about) ONLY when both parts matter about equally to what the parties were actually fighting over.
5b. FORCED RULING: separately from the verdict, you MUST pick which side is MORE right — the side a real court would rule for under a preponderance standard, no ties allowed. This forced choice must NOT change your verdict in step 5. If your step-5 verdict already names a winner ("side_a" or "side_b"), your leaning MUST be that same side. Standards, by what the crux is:
   - FACTUAL crux left genuinely uncertain in step 5: which side's factual claim is more probable on current, well-established evidence; only if truly 50/50, fall through to the burden-of-proof rule below.
   - DEFINITIONAL crux: whose usage better matches how the language community actually uses the word (ordinary meaning, like a court reading a contract).
   - VALUES crux: which side the value framework below favors even slightly; if it is truly silent, broadly shared common-sense morality.
   - SPLIT: who is right about the more central part of what the parties were actually fighting over.
   - Otherwise / still tied: the party whose claim departs further from ordinary expectation bears the burden of proof and loses the tie.
   leaning_reason: ONE concrete sentence, at most ~25 words, giving the real reason that side edges it in everyday words, not the name of the standard ("Boiling the water is only the first step of making tea, and Party A stopped there.", "One late night doesn't outweigh three years of showing up.").
6. HONESTY RULES: never manufacture certainty — but a close call is still a call; uncertainty belongs in the reasoning, not in refusing to rule. Never rule against a side just because it was described less sympathetically. The narrator (usually Party A) gets no home advantage.

VALUE FRAMEWORK (set by the user): ${frameworkInstruction(framework)}

OUTPUT RULES:
- headline: at most 10 words, punchy, plain language, names the outcome.
- crux: one sentence, what this argument is REALLY about, said the way you'd say it out loud rather than as a "Whether X or Y" formula.
- All text concise and concrete — this is displayed on small cards.
- split_points only for "split" verdicts, otherwise null. conditional only for "conditional" verdicts, otherwise null.
- losing_side_best_point: the single strongest point of whichever side fares worse (for "conditional"/"dissolved", the best point that survives on the less-favored framing).
- facts_relied_on: empty array if the verdict rests on no contested facts.
${analyzeBFirst ? "\nPROCESS NOTE: analyze Party B's case fully before Party A's, to guard against order bias." : ""}${lang === "tr" ? TR_LANGUAGE_BLOCK : ""}

${humanStyle(lang)}`;
}

export type JudgeRun =
  | { ok: true; data: JudgeRunOutput }
  | { ok: false; blocked: boolean; error: string };

/** Added to the system prompt of premium judges only (`premium: true`). The
 * free judge prompt never carries it. */
export const PREMIUM_JUDGE_NOTE =
  "When a FACT-CHECK block is present, rely on it over memory for the facts it covers; if it marks a decisive fact unverified or mixed, treat that fact as unsettled. List any fact-checked fact your verdict depends on in facts_relied_on.";

export type JudgeOptions = {
  analyzeBFirst?: boolean;
  lang?: Lang;
  timeoutMs?: number;
  /** Model for this run. Absent: JUDGE_MODEL. */
  model?: string;
  /** Thinking depth. Absent: JUDGE_EFFORT, else "medium". */
  effort?: Effort;
  /** Extra material appended to the user message after the argument (the
   * premium FACT-CHECK block). */
  context?: string;
  /** Adds PREMIUM_JUDGE_NOTE to the system prompt. */
  premium?: boolean;
};

export async function judgeOnce(
  anonymizedArgument: string,
  framework: FrameworkChoice,
  opts: JudgeOptions = {},
): Promise<JudgeRun> {
  // Effort defaults to JUDGE_EFFORT (else "medium") inside claudeJson. The
  // premium options only add keys when set, so a call without them sends
  // exactly the request it always has.
  const system = systemPrompt(framework, opts.analyzeBFirst ?? false, opts.lang ?? "en");
  const res = await claudeJson<unknown>({
    system: opts.premium ? `${system}\n\n${PREMIUM_JUDGE_NOTE}` : system,
    user: opts.context
      ? `THE ARGUMENT:\n\n${anonymizedArgument}\n\n${opts.context}`
      : `THE ARGUMENT:\n\n${anonymizedArgument}`,
    schema: JUDGE_SCHEMA as unknown as Record<string, unknown>,
    timeoutMs: opts.timeoutMs,
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.effort ? { effort: opts.effort } : {}),
  });
  if (!res.ok) {
    return res.blocked
      ? { ok: false, blocked: true, error: `model refused (${res.reason})` }
      : { ok: false, blocked: false, error: res.error };
  }
  const parsed = JudgeRunOutput.safeParse(res.data);
  if (!parsed.success) {
    return { ok: false, blocked: false, error: `schema mismatch: ${parsed.error.message.slice(0, 200)}` };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Self-consistency: three independent runs (one analyzing B first as a
 * position-bias check). Confidence later derives from their agreement.
 * Diversity between runs comes from default sampling plus the B-first
 * variant — the model rejects non-default temperatures.
 * Runs are PARALLEL: paid-tier rate limits absorb a 3-request burst, and
 * latency becomes one run instead of three. judgeOnce never throws (errors
 * come back as results), so one failed run cannot sink the others.
 */
export async function judgeSelfConsistent(
  anonymizedArgument: string,
  framework: FrameworkChoice,
  lang: Lang = "en",
): Promise<JudgeRun[]> {
  // JUDGE_RUNS lets cost-conscious deployments trade confidence for requests
  // (1-3; aggregate caps confidence when fewer runs survive).
  const n = Math.min(3, Math.max(1, Number(process.env.JUDGE_RUNS) || 3));
  const configs = [{}, { analyzeBFirst: true }, {}].slice(0, n);
  return Promise.all(
    configs.map((config) => judgeOnce(anonymizedArgument, framework, { ...config, lang })),
  );
}

/** Budget for each escalation run. Tighter than the usual 120s so the
 * worst-case request (anonymize 60s + judges 120s + extra judges 45s + crux
 * trial 60s) stays inside the route's 300s maxDuration; a typical judge call
 * finishes well within it, and a timed-out extra run is simply ignored. */
export const EXTRA_RUN_TIMEOUT_MS = 45_000;

/**
 * Escalation: `n` more independent runs, in parallel, for a verdict whose
 * first round came back low-confidence. Configs alternate starting with
 * B-first (the first round is mostly A-first), keeping the order-bias check
 * balanced across the combined panel. Never throws: failed runs come back as
 * results, as in judgeSelfConsistent.
 */
export async function judgeExtra(
  n: number,
  anonymizedArgument: string,
  framework: FrameworkChoice,
  lang: Lang = "en",
  /** Premium escalation: the same FACT-CHECK context and note as the panel. */
  extra: Pick<JudgeOptions, "context" | "premium"> = {},
): Promise<JudgeRun[]> {
  const configs = Array.from({ length: Math.max(0, n) }, (_, i) => ({
    analyzeBFirst: i % 2 === 0,
  }));
  return Promise.all(
    configs.map((config) =>
      judgeOnce(anonymizedArgument, framework, {
        ...config,
        lang,
        timeoutMs: EXTRA_RUN_TIMEOUT_MS,
        ...extra,
      }),
    ),
  );
}
