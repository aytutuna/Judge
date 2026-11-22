/**
 * Premium clarifying questions: before judging, ask at most two short
 * questions, and only about missing facts that would change who wins. Fail-open: any
 * failure means no questions, and the client simply goes on to judge.
 *
 * The raw text goes to the model here (names are only removed later, with
 * the answers included); nothing from this call is stored or logged.
 */

import { claudeJson, LITE_MODEL } from "../claude";
import { loadLocales, voiceNote, type Lang } from "../i18n";
import { LANGS } from "../langs";
import type { ClarifyResponse } from "../types";

export const CLARIFY_TIMEOUT_MS = 20_000;
const MAX_QUESTIONS = 2;
const MAX_QUESTION_CHARS = 140;

export const CLARIFY_SYSTEM = `You help an impartial judge settle an argument between two parties. Before the judge rules, you may ask the person describing the argument a question, but only when the judge would otherwise have to guess who wins.

The default is no questions. Most arguments need none: the judge rules on what is written, and a detail left out is fine when it would not change the result. Ask only about a missing fact that decides who wins and that the text does not already answer: what was agreed, what actually happened, a number, a date or the exact claim one side made. Never ask about values, priorities or preferences (the judge has a value framework for those), never ask for names or personal details, and never ask something the text already answers.

For each question, give its two most likely answers and who wins with each: side_1 is the party the text mentions first, side_2 the other one, neither for a tie or a split. If both answers give the same winner, the question does not matter, so leave it out. One question is almost always enough; add a second only when it is about a different fact and just as decisive. Never more than 2.

Each question is one short sentence, at most 20 words, addressed to the person asking ("you"), written in the language requested below.`;

const LANGUAGE_LINE: Partial<Record<Lang, string>> = {
  en: "\n\nLANGUAGE: write the questions in English.",
  tr: '\n\nLANGUAGE: write the questions in Turkish, in everyday words, addressing the person with informal "sen", never "siz".',
};

const WINNER = { type: "string", enum: ["side_1", "side_2", "neither"] } as const;

const SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer_1: { type: "string" },
          winner_1: WINNER,
          answer_2: { type: "string" },
          winner_2: WINNER,
        },
        required: ["question", "answer_1", "winner_1", "answer_2", "winner_2"],
      },
    },
  },
  required: ["questions"],
} as const;

const WINNERS = new Set<unknown>(WINNER.enum);

/** A question only counts when its two likely answers change the winner. */
function decisive(q: unknown): q is { question: string } {
  if (typeof q !== "object" || q === null) return false;
  const { question, winner_1, winner_2 } = q as Record<string, unknown>;
  return typeof question === "string" && WINNERS.has(winner_1) && WINNERS.has(winner_2) && winner_1 !== winner_2;
}

/** A question cut to the length cap at a word boundary. */
function shorten(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= MAX_QUESTION_CHARS) return t;
  const cut = t.slice(0, MAX_QUESTION_CHARS - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 60 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The model's decisive questions as the API shape: trimmed, capped,
 * empties dropped, ids q1/q2. Pure. */
export function toClarifyResponse(raw: unknown): ClarifyResponse {
  const list =
    typeof raw === "object" && raw !== null && Array.isArray((raw as { questions?: unknown }).questions)
      ? ((raw as { questions: unknown[] }).questions)
      : [];
  const texts = list
    .filter(decisive)
    .map((q) => shorten(q.question))
    .filter((q) => /\p{L}/u.test(q))
    .slice(0, MAX_QUESTIONS);
  return { questions: texts.map((text, i) => ({ id: `q${i + 1}`, text })) };
}

function languageLine(lang: Lang): string {
  const line = LANGUAGE_LINE[lang];
  if (line) return line;
  const voice = voiceNote(lang);
  return `\n\nLANGUAGE: write the questions in ${LANGS[lang].name}, in everyday words.${voice ? ` ${voice}` : ""}`;
}

/** Up to two clarifying questions for `argument`. Never throws; [] on any
 * failure, refusal or timeout. */
export async function clarifyQuestions(argument: string, lang: Lang): Promise<ClarifyResponse> {
  try {
    await loadLocales();
    const res = await claudeJson<unknown>({
      system: `${CLARIFY_SYSTEM}${languageLine(lang)}`,
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
