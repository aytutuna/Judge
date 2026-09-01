import { geminiJson, hasApiKey, LITE_MODEL } from "./gemini";
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

/**
 * Names -> Party A/B before judging and storage. Doubles as bias mitigation:
 * the judge never sees who is who. The name map is returned to the client for
 * display but never stored.
 */
export async function anonymize(argument: string): Promise<AnonymizeResult> {
  if (!hasApiKey()) {
    // Unreachable via the API route (it refuses without a key); kept as a
    // guard so a stray call degrades to raw text instead of a wasted request.
    return { text: argument, nameMap: [] };
  }
  const res = await geminiJson<{
    text: string;
    replacements: { original: string; replacement: string }[];
  }>({
    system: SYSTEM,
    user: argument,
    schema: SCHEMA,
    temperature: 0.1,
    // No thinkingBudget: the lite model rejects thinkingConfig entirely.
    model: LITE_MODEL,
  });

  if (!res.ok) {
    console.warn(
      "[anonymize] falling back to raw text:",
      res.blocked ? `blocked (${res.reason})` : res.error,
    );
    // If anonymization itself is blocked or fails, fall back to the raw text:
    // judging may still work, and we never fail the whole request here.
    return { text: argument, nameMap: [] };
  }
  const nameMap = res.data.replacements.filter(
    (r) => r.original.trim() && r.original.trim() !== r.replacement.trim(),
  );
  return { text: res.data.text, nameMap };
}
