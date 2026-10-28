/**
 * Premium clarifying questions: before judging, ask at most two short
 * questions about missing facts that would change who wins. Fail-open: any
 * failure means no questions, and the client simply goes on to judge.
 *
 * The raw text goes to the model here (names are only removed later, with
 * the answers included); nothing from this call is stored or logged.
 */

import { claudeJson, LITE_MODEL } from "../claude";
import type { Lang } from "../i18n";
import type { ClarifyResponse } from "../types";

export const CLARIFY_TIMEOUT_MS = 20_000;
const MAX_QUESTIONS = 2;
const MAX_QUESTION_CHARS = 140;

export const CLARIFY_SYSTEM = `You help an impartial judge settle an argument between two parties. Before the judge rules, you may ask the person describing the argument up to 2 short questions.

Ask ONLY about missing facts that would change who wins and that the text does not already answer: what was agreed, what actually happened, numbers, dates or the exact claim each side made. Never ask about values, priorities or preferences (the judge has a value framework for those), never ask for names or personal details, and never ask something the text already answers. Each question is one short sentence, at most 20 words, addressed to the person asking ("you"), written in the language requested below.

If nothing decisive is missing, return an empty questions array. Most well-described arguments need no questions.`;

const LANGUAGE_LINE: Record<"en" | "tr", string> = {
  en: "\n\nLANGUAGE: write the questions in English.",
  tr: '\n\nLANGUAGE: write the questions in Turkish, in everyday words, addressing the person with informal "sen", never "siz".',
};

const SCHEMA = {
  type: "object",
  properties: { questions: { type: "array", items: { type: "string" } } },
  required: ["questions"],
} as const;

/** A question cut to the length cap at a word boundary. */
function shorten(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= MAX_QUESTION_CHARS) return t;
  const cut = t.slice(0, MAX_QUESTION_CHARS - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 60 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The model's questions as the API shape: trimmed, capped, empties dropped,
 * ids q1/q2. Pure. */
export function toClarifyResponse(raw: unknown): ClarifyResponse {
  const list =
    typeof raw === "object" && raw !== null && Array.isArray((raw as { questions?: unknown }).questions)
      ? ((raw as { questions: unknown[] }).questions)
      : [];
  const texts = list
    .filter((q): q is string => typeof q === "string")
    .map(shorten)
    .filter((q) => /\p{L}/u.test(q))
    .slice(0, MAX_QUESTIONS);
  return { questions: texts.map((text, i) => ({ id: `q${i + 1}`, text })) };
}

/** Up to two clarifying questions for `argument`. Never throws; [] on any
 * failure, refusal or timeout. */
export async function clarifyQuestions(argument: string, lang: Lang): Promise<ClarifyResponse> {
  try {
    const res = await claudeJson<unknown>({
      system: `${CLARIFY_SYSTEM}${LANGUAGE_LINE[lang === "tr" ? "tr" : "en"]}`,
      user: `THE ARGUMENT:\n\n${argument}`,
      schema: SCHEMA,
      model: LITE_MODEL,
      effort: "low",
      timeoutMs: CLARIFY_TIMEOUT_MS,
    });
    if (!res.ok) {
      console.warn("[clarify] no questions:", res.blocked ? `blocked (${res.reason})` : res.error);
      return { questions: [] };
    }
    return toClarifyResponse(res.data);
  } catch (e) {
    console.warn("[clarify] failed open:", e instanceof Error ? e.message : String(e));
    return { questions: [] };
  }
}
