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
const MAX_OPTION_CHARS = 80;
/** A question is only asked when the model is less sure than this of its own guess. */
const CONFIDENCE_BELOW = 70;

export const CLARIFY_SYSTEM = `You help an impartial judge settle an argument between two parties. Before the judge rules, you may ask the person describing the argument a question, but only when the judge would otherwise have to guess who wins.

The default is no questions. Most arguments need none: the judge rules on what is written, and a detail left out is fine when the judge can reasonably assume it or when it would only change the margin and not the winner. Set ask to true only when a fact the text leaves open really decides who wins and the judge cannot reasonably infer it: what was agreed, what actually happened, a number, a date or the exact claim one side made. Otherwise set ask to false and return no questions. Never ask about something either side's text already states or implies. Never ask about values, priorities or preferences (the judge has a value framework for those), and never ask for names or personal details.

For each question, give its two most likely answers and who wins with each: side_1 is the party the text mentions first, side_2 the other one, neither for a tie or a split. If both answers give the same winner, the question does not matter, so leave it out. Also say which answer you think is more likely from the text alone (best_guess, 1 or 2) and how sure you are of that, 0 to 100 (confidence). If you can guess the answer, the judge would assume the same, so the question is not worth asking. One question is almost always enough; add a second only when it is about a different fact and just as decisive. Never more than 2.

Each question is one short sentence, at most 20 words, addressed to the person asking ("you"), written in the language requested below. Each answer is a short reply the person could tap, a few words, in the same language, from their own point of view ("Yes, I paid in cash"), not a description of what happened.`;

const LANGUAGE_LINE: Partial<Record<Lang, string>> = {
  en: "\n\nLANGUAGE: write the questions in English.",
  tr: '\n\nLANGUAGE: write the questions in Turkish, in everyday words, addressing the person with informal "sen", never "siz".',
};

const WINNER = { type: "string", enum: ["side_1", "side_2", "neither"] } as const;

const SCHEMA = {
  type: "object",
  properties: {
    ask: { type: "boolean" },
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
          best_guess: { type: "integer", enum: [1, 2] },
          confidence: { type: "integer" },
        },
        required: ["question", "answer_1", "winner_1", "answer_2", "winner_2", "best_guess", "confidence"],
      },
    },
  },
  required: ["ask", "questions"],
} as const;

const WINNERS = new Set<unknown>(WINNER.enum);

/** A question only counts when its two likely answers change the winner and
 * the model could not simply guess which one is true. */
function worthAsking(q: unknown): q is { question: string; answer_1?: unknown; answer_2?: unknown } {
  if (typeof q !== "object" || q === null) return false;
  const { question, winner_1, winner_2, best_guess, confidence } = q as Record<string, unknown>;
  return (
    typeof question === "string" &&
    WINNERS.has(winner_1) &&
    WINNERS.has(winner_2) &&
    winner_1 !== winner_2 &&
    (best_guess === 1 || best_guess === 2) &&
    typeof confidence === "number" &&
    confidence < CONFIDENCE_BELOW
  );
}

/** A question cut to the length cap at a word boundary. */
function shorten(text: string, max = MAX_QUESTION_CHARS): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2.3 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The two likely answers as tappable options: capped, empties and repeats dropped. */
function optionsOf(q: { answer_1?: unknown; answer_2?: unknown }): string[] {
  const out: string[] = [];
  for (const a of [q.answer_1, q.answer_2]) {
    if (typeof a !== "string") continue;
    const o = shorten(a, MAX_OPTION_CHARS);
    if (/\p{L}|\p{N}/u.test(o) && !out.some((x) => x.toLowerCase() === o.toLowerCase())) out.push(o);
  }
  return out;
}

/** The model's questions worth asking as the API shape: trimmed, capped,
 * empties dropped, ids q1/q2. No questions unless the model set `ask`. Pure. */
export function toClarifyResponse(raw: unknown): ClarifyResponse {
  const { ask, questions: asked } = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const list = ask === true && Array.isArray(asked) ? asked : [];
  const questions = list
    .filter(worthAsking)
    .map((q) => ({ text: shorten(q.question), options: optionsOf(q) }))
    .filter((q) => /\p{L}/u.test(q.text))
    .slice(0, MAX_QUESTIONS);
  return { questions: questions.map((q, i) => ({ id: `q${i + 1}`, ...q })) };
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
