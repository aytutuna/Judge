import { voiceNote, type Lang } from "./i18n";
import { LANGS } from "./langs";
import { partyLabel, readingOrder } from "./multi";
import { humanStyle } from "./style";
import { DisputeType, OtherLine, SideAnalysis, Dispute, PartyId } from "./types";
import { z } from "zod";

/**
 * The judge for a dispute with three or four sides: its own output schema,
 * system prompt and parsing, next to the two-sided ones in lib/judge.ts.
 * A run names one winner among the listed sides or "too_close", and gives
 * every side's claims and bedrock plus one line for each side that did not
 * win. Two-sided verdicts never come through here.
 */

const CLAIM = {
  type: "object",
  properties: {
    claim: { type: "string" },
    kind: { type: "string", enum: ["fact", "value", "definition", "logic"] },
  },
  required: ["claim", "kind"],
} as const;

/** One judge run on three or four sides. `agreed_facts`, `disputes` and
 * `would_change` are present when the sides are separate accounts. */
export const MultiRunOutput = z.object({
  verdict: z.union([PartyId, z.literal("too_close")]),
  dispute_type: DisputeType,
  headline: z.string(),
  why: z.string(),
  crux: z.string(),
  sides: z.array(SideAnalysis),
  facts_relied_on: z.array(z.string()),
  others: z.array(OtherLine),
  agreed_facts: z.array(z.string()).optional(),
  disputes: z.array(Dispute).optional(),
  would_change: z.array(z.string()).optional(),
  leaning: PartyId,
  leaning_reason: z.string(),
});
export type MultiRunOutput = z.infer<typeof MultiRunOutput>;

/**
 * The output schema for `parties`. Property order is the anchoring guard of
 * JUDGE_SCHEMA again: `leaning` and `leaning_reason` stay the LAST two
 * properties (and last in `required`), so the verdict is fully emitted
 * before the forced choice exists. Never reorder them.
 */
export function multiSchema(parties: readonly PartyId[], accounts: boolean) {
  const ids = [...parties];
  const properties = {
    verdict: { type: "string", enum: [...ids, "too_close"] },
    dispute_type: { type: "string", enum: ["factual", "logical", "definitional", "values", "mixed"] },
    headline: { type: "string" },
    why: { type: "string" },
    crux: { type: "string" },
    sides: {
      type: "array",
      items: {
        type: "object",
        properties: {
          party: { type: "string", enum: ids },
          claims: { type: "array", items: CLAIM },
          bedrock: { type: "string" },
        },
        required: ["party", "claims", "bedrock"],
      },
    },
    facts_relied_on: { type: "array", items: { type: "string" } },
    others: {
      type: "array",
      items: {
        type: "object",
        properties: { party: { type: "string", enum: ids }, line: { type: "string" } },
        required: ["party", "line"],
      },
    },
    ...(accounts
      ? {
          agreed_facts: { type: "array", items: { type: "string" } },
          disputes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                fact: { type: "string" },
                positions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { party: { type: "string", enum: ids }, says: { type: "string" } },
                    required: ["party", "says"],
                  },
                },
                finding: { type: "string", enum: [...ids, "unsettled"] },
                decisive: { type: "boolean" },
              },
              required: ["fact", "positions", "finding", "decisive"],
            },
          },
          would_change: { type: "array", items: { type: "string" } },
        }
      : {}),
    leaning: { type: "string", enum: ids },
    leaning_reason: { type: "string" },
  };
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
  } as const;
}

function languageBlock(lang: Lang): string {
  if (lang === "en") return "";
  const voice = voiceNote(lang);
  return `

LANGUAGE: Write every free-text output field (headline, why, crux, claims, bedrock premises, others lines, facts_relied_on, leaning_reason) in ${LANGS[lang].name}, following the VOICE rules below.${voice ? ` ${voice}` : ""} Name the sides by their labels "Party A", "Party B", "Party C" and "Party D" the way the language note names Party A and Party B, with the letter C or D in the same place. Keep all JSON enum values exactly as specified in the schema (English identifiers). headline stays at most 10 words.`;
}

/** The system prompt for judge seat `seat` on `parties`. The reading order
 * is rotated by seat; seat 0 reads in order and gets no process note. */
export function multiSystemPrompt(parties: readonly PartyId[], seat: number, lang: Lang): string {
  const labels = parties.map(partyLabel);
  const list = labels.join(", ").replace(/, ([^,]*)$/, " and $1");
  const ids = parties.map((p) => `"${p}"`).join(", ");
  const order = readingOrder(parties, seat);
  const rotated = order.some((p, i) => p !== parties[i]);
  const note = rotated
    ? `\nPROCESS NOTE: analyze the sides in this order: ${order.map(partyLabel).join(", ")}, to guard against order bias. Give every side the same care wherever it falls in the order.`
    : "";
  return `You are Verdict, an impartial adjudicator of arguments among ${parties.length} parties: ${list}.

METHOD — follow these steps in order:
1. STEELMAN: restate each side's position in its strongest form. One side being badly worded, or described only briefly, must not cost it the verdict. Correct for how each side was framed and give every side full strength.
2. CLASSIFY: break each side's case into its distinct claims (2-4 per side) and label each claim's kind: "fact" (checkable about the world), "value" (what matters or should be), "definition" (what a word means), "logic" (an inference from other claims).
3. BEDROCK: for each side, dig below its claims to the single deepest premise it ultimately rests on: a terminal value or a foundational factual belief. One short phrase each.
4. CRUX: state, in one sentence, the point that separates the winner from the other sides. Everything above the crux is noise.
5. VERDICT: people come here to find out who is right. Naming ONE winner (${ids}) is the DEFAULT; "too_close" is an exception you must earn. Before returning it, ask: "If I had to rule, would I know which side to rule for?" If yes, rule for that side. A winner can still be partly wrong, and the other sides' best points belong in their "others" lines. Never name two winners and never merge sides. Choose by what the crux is:
   - Crux is a checkable FACT or a LOGICAL error: pick the winner. List in facts_relied_on every factual claim your verdict depends on, so users can check them. Use only well-established knowledge. If the decisive fact is not settled but the evidence clearly favors one side, pick that side; only a genuine evidential toss-up falls through to "too_close".
   - Crux is a clash of TERMINAL VALUES: apply the value framework below. If it favors one side, even moderately, pick that side and make clear in the crux, in everyday words, that this comes down to which priority matters more and which one tips it. Return "too_close" ONLY when the framework is genuinely balanced between the leading sides.
   - Crux is what a key WORD means: the side whose usage matches how the word is ordinarily used in this context wins, like a court reading a contract.
   - Each side is right about a DIFFERENT part: the side that is right about the part the argument is centrally about wins. Return "too_close" ONLY when the leading sides are right about parts that matter about equally.
5b. FORCED RULING: separately from the verdict, you MUST pick which side is MORE right, the side a real court would rule for under a preponderance standard, no ties allowed. This forced choice must NOT change your verdict in step 5. If your step-5 verdict names a winner, your leaning MUST be that same side. Standards, by what the crux is:
   - FACTUAL crux left genuinely uncertain in step 5: which side's factual claim is more probable on current, well-established evidence; only if truly 50/50, fall through to the burden-of-proof rule below.
   - DEFINITIONAL crux: whose usage better matches how the language community actually uses the word.
   - VALUES crux: which side the value framework below favors even slightly; if it is truly silent, broadly shared common-sense morality.
   - Otherwise / still tied: the party whose claim departs further from ordinary expectation bears the burden of proof and loses the tie.
   leaning_reason: ONE concrete sentence, at most ~25 words, giving the real reason that side edges it in everyday words, not the name of the standard.
6. HONESTY RULES: never manufacture certainty, but a close call is still a call; uncertainty belongs in the reasoning, not in refusing to rule. Never rule against a side just because it was described less sympathetically. The narrator (usually Party A) gets no home advantage.

VALUE FRAMEWORK: Weigh values the way broadly shared common-sense morality does: outcomes, fairness, rights, and relationships all count, none automatically dominates.

OUTPUT RULES:
- verdict: one of ${ids}, or "too_close".
- headline: at most 10 words, punchy, plain language, names the outcome.
- why: 2-3 plain sentences, at most 60 words, saying what actually decided it: the fact, agreement or reason that tips it, and why the other sides' cases don't outweigh it. For a values call, say which priority tips it; for "too_close", say what it turns on instead of writing as if one side won.
- crux: one sentence, what this argument is REALLY about, said the way you'd say it out loud rather than as a "Whether X or Y" formula.
- sides: one entry for each of ${ids}, in that order, with its claims and its bedrock premise.
- others: for EACH side that did not win, one entry with that side's letter and ONE short sentence (at most 20 words) saying where it fell short. An empty array when the verdict is "too_close".
- All text concise and concrete, as it is displayed on small cards.
- facts_relied_on: empty array if the verdict rests on no contested facts.${note}${languageBlock(lang)}

${humanStyle(lang)}`;
}

/** Added when the sides are separate accounts, each written by that party
 * without seeing the others'. */
export function multiAccountsNote(parties: readonly PartyId[]): string {
  const labels = parties.map((p) => `"${partyLabel(p)}'s account"`).join(", ");
  return `SEPARATE ACCOUNTS: this case has ${parties.length} separate accounts, ${labels}, each written by that party without seeing the others'. Step 1's note about a single narrator does not apply: every side speaks for itself, so steelman each from its own account. No account is true by default; each narrator tells it in their own favor.
- agreed_facts: facts every account that touches them states or clearly accepts (at most 5, short). Treat them as established.
- disputes: facts the accounts contradict (at most 4). For each: fact = a neutral one-line statement of what is disputed; positions = what each side claims about it, briefly, one entry per side that speaks to it; finding = the side's letter when the evidence or the other accounts' own admissions clearly support that side, else "unsettled" (a record a party wrote themselves does not on its own clearly support that party); decisive = true for the one disputed fact the verdict hinges on (at most one; all false if the verdict rests on agreed facts or values).
- Weigh disputed facts by internal consistency, specificity, admissions against interest and the EVIDENCE transcripts. A transcript beats an unsupported claim but may be selective, cropped or out of context, and proves only what it shows.
- Burden of proof on a disputed fact: the side whose case needs it and whose claim departs further from ordinary expectation must support it; a bare assertion another account contradicts does not meet that burden. Never settle a disputed fact by guessing.
- Name in the crux the disputed fact or value clash the verdict hinges on.
- would_change: 1-3 short items naming the specific evidence or fact that would flip or change this verdict. Never ask for anything that identifies a real person.
- Silence on a point is not a concession; brevity is not a weakness.
Write agreed_facts, disputes and would_change in the same language and voice as the other text fields.`;
}

/** The re-judging note for an appeal on a dispute with several sides: the
 * given context was added by `party`, who has seen the earlier verdict. */
export function multiAppealNote(party: PartyId): string {
  return `An earlier verdict exists and ${partyLabel(party)} added NEW CONTEXT in reply. Judge the whole record afresh. The other parties have not answered the new context, so new factual claims made only now, without support, carry less weight than claims the other accounts address.`;
}

/** A run's JSON checked against the sides it was asked about, or why not.
 * Entries naming a side that is not in the dispute are dropped. */
export function parseMultiRun(
  data: unknown,
  parties: readonly PartyId[],
): { ok: true; data: MultiRunOutput } | { ok: false; error: string } {
  const parsed = MultiRunOutput.safeParse(data);
  if (!parsed.success) return { ok: false, error: parsed.error.message.slice(0, 200) };
  const run = parsed.data;
  const known = (p: PartyId) => parties.includes(p);
  if ((run.verdict !== "too_close" && !known(run.verdict)) || !known(run.leaning)) {
    return { ok: false, error: "verdict names a side outside the dispute" };
  }
  return {
    ok: true,
    data: {
      ...run,
      sides: run.sides.filter((s) => known(s.party)),
      others: run.others.filter((o) => known(o.party)),
      ...(run.disputes
        ? {
            disputes: run.disputes
              .map((d) => ({ ...d, positions: d.positions.filter((p) => known(p.party)) }))
              .filter((d) => d.finding === "unsettled" || known(d.finding as PartyId)),
          }
        : {}),
    },
  };
}
