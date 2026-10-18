import { claudeJson, hasApiKey, LITE_MODEL } from "./claude";
import type { NameMapping } from "./types";

export type AnonymizeResult = {
  text: string;
  nameMap: NameMapping[];
};

const SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string" },
    replacements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original: { type: "string" },
          replacement: { type: "string" },
        },
        required: ["original", "replacement"],
      },
    },
  },
  required: ["text", "replacements"],
} as const;

const SYSTEM = `You anonymize descriptions of arguments between two parties.

Rewrite the text with these rules:
- The two people having the argument become "Party A" and "Party B". If the text is written in first person ("I", "me"), the narrator is Party A and the other person is Party B.
- Replace their real names, usernames, and nicknames everywhere with those labels, keeping grammar natural (adjust pronouns only where a name was used).
- Other named people become "Person C", "Person D", and so on.
- Replace specific company, school, or place names that could identify someone with generic terms ("the company", "their school", "the city").
- Change NOTHING else: keep every claim, detail, number, and the tone exactly as written.
- List every replacement you made.
- If there is nothing to anonymize, return the text unchanged with an empty replacements list.

Always keep the rewritten text in the SAME language as the input. The replacement labels are always exactly "Party A", "Party B", "Person C"… regardless of language.`;

/** Thrown when the text could not be anonymized. Callers must not judge or
 * store the raw text instead: it still carries the real names. */
export class AnonymizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnonymizeError";
  }
}

/**
 * Names -> Party A/B before judging and storage. Doubles as bias mitigation:
 * the judge never sees who is who. The name map is returned to the client for
 * display but never stored. Fails closed: throws AnonymizeError rather than
 * ever returning the raw text.
 */
export async function anonymize(argument: string): Promise<AnonymizeResult> {
  if (!hasApiKey()) {
    // Unreachable via the API route (it refuses without a key).
    throw new AnonymizeError("ANTHROPIC_API_KEY not set");
  }
  const res = await claudeJson<{
    text: string;
    replacements: { original: string; replacement: string }[];
  }>({
    system: SYSTEM,
    user: argument,
    schema: SCHEMA,
    // Mechanical rewrite: low effort keeps thinking (and latency) minimal.
    effort: "low",
    model: LITE_MODEL,
    // Runs before the judges on every request; a stall here fails the
    // request early instead of holding it for the full judge budget.
    timeoutMs: 60_000,
  });

  if (!res.ok) {
    throw new AnonymizeError(res.blocked ? `blocked (${res.reason})` : res.error);
  }
  // Structured outputs should guarantee the shape; a missing text would
  // otherwise slip an empty or undefined argument past the judges.
  if (
    typeof res.data?.text !== "string" ||
    !res.data.text.trim() ||
    !Array.isArray(res.data.replacements)
  ) {
    throw new AnonymizeError("anonymizer returned malformed output");
  }
  const nameMap = res.data.replacements.filter(
    (r) => r.original.trim() && r.original.trim() !== r.replacement.trim(),
  );
  return { text: res.data.text, nameMap };
}
