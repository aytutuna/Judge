import { claudeJson, hasApiKey, LITE_MODEL } from "./claude";
import { bareName, canonicalLabel, EN_SELF, TR_SELF, trSuffix, type TrCase } from "./names";
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
- The two people having the argument become "Party A" and "Party B". If the narrator is one of the two sides, the narrator is ALWAYS Party A and the other person is Party B.
- First person marks the narrator in any language. English: "I", "me", "my", "myself". Turkish: "ben", "bence", "benim", "bana", "beni", "bende", "benden", "benimle", and also first-person endings with no pronoun at all ("düşünüyorum", "söyledim", "haklıyım", "arkadaşım").
- Rewrite the narrator's first-person sentences about Party A in the third person, adjusting only the pronoun and verb ending ("I think" -> "Party A thinks", "Ben ise düşünüyorum" -> "Party A ise düşünüyor").
- Replace the parties' real names, usernames, and nicknames everywhere with those labels, keeping grammar natural (adjust pronouns only where a name was used). In Turkish text keep the case suffix on the label after an apostrophe ("Deniz'in" -> "Party B'nin", "Deniz'e" -> "Party B'ye").
- Other named people become "Person C", "Person D", and so on.
- Replace specific company, school, or place names that could identify someone with generic terms ("the company", "their school", "the city").
- Change NOTHING else: keep every claim, detail, number, and the tone exactly as written.
- List every replacement you made, one entry per person, not one per inflected form.
- In each replacement, "original" is the bare name exactly as spelled, WITHOUT any case suffix, possessive ending, or apostrophe ("Deniz", never "Deniz'in" or "Deniz'e"; "Mark", never "Mark's"), and "replacement" is the bare label ("Party B", never "Party B'nin").
- When the narrator is a side, ALWAYS include the entry {"original": "I", "replacement": "Party A"} for English text or {"original": "Ben", "replacement": "Party A"} for Turkish text, even if the pronoun itself never appears.
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
  const nameMap = normalizeNameMap(res.data.replacements, argument, res.data.text);
  return { text: res.data.text, nameMap };
}

// --- Name map normalization ---------------------------------------------------

/** Cases a suffix glued on without an apostrophe may be ("Denizin"). */
const TR_GLUED_CASES: readonly TrCase[] = ["gen", "acc", "dat", "loc", "abl", "ins"];

/** Second-person forms: "Sena" is never "Sen" + "-a". */
const TR_SECOND_PERSON = new Set([
  "sen", "sana", "seni", "senin", "sende", "senden", "seninle", "sence", "senki",
  "siz", "size", "sizi", "sizin", "sizde", "sizden", "sizinle", "sizce",
]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether the text before `index` leaves it in the middle of a sentence:
 * not at the start, after sentence punctuation or right after a quote. */
function midSentence(text: string, index: number): boolean {
  const before = text.slice(0, index).trimEnd();
  return before !== "" && !/[.!?…:;"“”‘’'«»(\[—–-]$/u.test(before);
}

/**
 * The name without a Turkish suffix glued on with no apostrophe ("Denizin"
 * -> "Deniz"). Deliberately strict, because a wrong cut renames someone
 * ("Sena" -> "Sen", "Dana" -> "Dan"); the name is kept unless all hold:
 * - the argument is Turkish;
 * - the full form never appears with an apostrophe suffix ("Martin'e"
 *   proves "Martin" is the name);
 * - the cut-off part is a case suffix that agrees with the base by vowel
 *   harmony ("Mart" + "in" does not: it would be "Martın");
 * - the base is not another person in the map, a pronoun ("Sen") or a
 *   first-person form;
 * - the base appears as a name elsewhere: with an apostrophe suffix
 *   ("Deniz'e") or capitalized in the middle of a sentence, where a common
 *   word ("Dur!") would be lowercase.
 */
function stripGluedSuffix(name: string, argument: string, turkish: boolean, taken: ReadonlySet<string>): string {
  if (!turkish || /[\s'’]/u.test(name)) return name;
  if (new RegExp(`(?<!\\p{L})${escapeRe(name)}['’]\\p{Ll}`, "u").test(argument)) return name;
  for (let k = 1; k <= 3 && name.length - k >= 3; k++) {
    const base = name.slice(0, -k);
    const suffix = name.slice(-k).toLocaleLowerCase("tr");
    if (!TR_GLUED_CASES.some((c) => trSuffix(base, c) === suffix)) continue;
    const key = base.toLocaleLowerCase("tr");
    if (taken.has(key) || TR_SECOND_PERSON.has(key) || TR_SELF.has(key)) continue;
    const esc = escapeRe(base);
    if (new RegExp(`(?<!\\p{L})${esc}['’]\\p{Ll}+(?!\\p{L})`, "u").test(argument)) return base;
    for (const m of argument.matchAll(new RegExp(`(?<!\\p{L})${esc}(?![\\p{L}\\p{N}'’])`, "gu"))) {
      if (midSentence(argument, m.index)) return base;
    }
  }
  return name;
}

/** Common function words, for telling the argument's language apart. They
 * leave out words that are also everyday words in the other language
 * ("her", "on", "not", "can", "but", "be", "he", "of"). */
const TR_COMMON = new Set([
  "ve", "bir", "bu", "şu", "o", "da", "de", "ki", "ama", "fakat", "çok", "için", "ne", "mi", "mı",
  "mu", "mü", "değil", "gibi", "daha", "ile", "hiç", "sonra", "çünkü", "neden", "var", "yok",
  "diyor", "dedi", "sen", "sana", "onu", "ona", "şey", "kadar", "en", "hem", "ya", "veya", "ise",
  "olarak", "artık", "hep", "bile", "olur", "oldu", "olmaz",
]);
const EN_COMMON = new Set([
  "the", "and", "is", "are", "was", "were", "been", "to", "in", "that", "this", "it", "she",
  "him", "they", "them", "their", "we", "you", "says", "said", "told", "think", "thinks", "with",
  "for", "from", "about", "if", "because", "would", "will", "should", "could", "have", "has",
  "had", "does", "did", "what", "who", "when", "there", "which", "just", "so", "or", "also",
  "very", "wants", "agree", "agrees",
]);

/**
 * Whether the argument is written in Turkish. Turkish markers (function
 * words, first-person forms and verb endings) must outweigh English ones,
 * and with no Turkish letters at all there must be at least two of them
 * and no English first person. One "ü" in "Jürgen" plus a manager named
 * "Ben" is an English story, not a Turkish narrator.
 */
function looksTurkish(text: string, fp: ReturnType<typeof firstPerson>): boolean {
  // Words after an apostrophe are suffixes or contractions ("I've"), not words.
  const words = text.toLocaleLowerCase("tr").match(/(?<![\p{L}'’])\p{L}+/gu) ?? [];
  const tr = words.filter((w) => TR_COMMON.has(w)).length + fp.trAny + fp.trVerbs;
  const en = words.filter((w) => EN_COMMON.has(w)).length + fp.enAny;
  if (tr <= en) return false;
  return /[çğışöüÇĞİŞÖÜ]/u.test(text) || (fp.enAny === 0 && tr >= 2);
}

/** Counts of first-person markers. Labels are removed first so the "I" of
 * "Person I" never counts. "Strong" markers are the narrator acting or
 * being acted on ("I", "me", "ben", "bana", "beni"…); possessives ("my",
 * "benim") only count towards presence, because "my wife" turns into a
 * label when the wife is a side, without the narrator being one. Turkish
 * also counts first-person verb endings ("düşünüyorum", "söyledim"). */
function firstPerson(text: string) {
  const plain = text.replace(/(?:Party|Taraf|Person|Kişi) [A-Z](?![\p{L}\p{N}])/gu, " ");
  const count = (re: RegExp) => plain.match(re)?.length ?? 0;
  const enStrong = count(/(?<![\p{L}'’])(?:I(?:['’](?:m|ve|d|ll))?|[Mm]e|[Mm]yself)(?![\p{L}'’])/gu);
  const enAny = enStrong + count(/(?<![\p{L}'’])(?:[Mm]y|[Mm]ine)(?![\p{L}'’])/gu);
  const words = plain.toLocaleLowerCase("tr").match(/\p{L}+/gu) ?? [];
  const trAny = words.filter((w) => TR_SELF.has(w)).length;
  const trStrong = words.filter((w) => TR_SELF.has(w) && !TR_POSSESSIVE.has(w)).length;
  const trVerbs = words.filter(
    (w) =>
      !TR_VERB_LOOKALIKES.has(w) &&
      /\p{L}{2,}(?:[ıiuü]?yorum|yordum|[ae]c[ae]ğ[ıi]m|m[ıiuü]ş[ıiuü]m|[dt][ıiuü]m|y[ıiuü]m)$/u.test(w),
  ).length;
  return { enStrong, enAny, trAny, trStrong, trVerbs };
}

const TR_POSSESSIVE = new Set(["benim", "benimki"]);

/** Everyday nouns that end like a first-person verb. */
const TR_VERB_LOOKALIKES = new Set(["yardım", "tutum", "giyim", "kıyım", "boyum", "koyum"]);

/**
 * The anonymizer's replacement list, made reliable for display:
 * - labels are canonical ("taraf b'ye" -> "Party B");
 * - originals are bare names ("Deniz'in", "Deniz’e", "Denizin" -> "Deniz");
 * - a narrator becomes "I" in either language ("me", "benim" -> "I"; a
 *   bare "Ben" only when the argument is Turkish);
 * - duplicates collapse to one entry;
 * - a first-person narrator the model rewrote (or left for the judges to
 *   call Party A) without listing gets its entry, so the card shows
 *   "You"/"Sen" instead of "Party A". It is only added when Party A has no
 *   entry and the narrator's first-person markers disappeared from the
 *   rewritten text (or no Party A label exists there at all while Party B
 *   does) — a narrator who merely reports on two other people keeps their
 *   "I" in the rewritten text and is never mistaken for a side.
 * Pure and deterministic; exported for tests.
 */
export function normalizeNameMap(
  replacements: readonly { original: string; replacement: string }[],
  argument: string,
  text: string,
  /** The narrator's label: "Party A" (default, every one-account argument)
   * or "Party B" (the respondent's account of a two-sided case). The other
   * party label is the one the narrator argues with. */
  opts: { narrator?: "Party A" | "Party B" } = {},
): NameMapping[] {
  const narrator = opts.narrator ?? "Party A";
  const other = narrator === "Party A" ? "Party B" : "Party A";
  const out: NameMapping[] = [];
  const seen = new Set<string>();
  const push = (m: NameMapping) => {
    const key = `${m.original}\u0000${m.replacement}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };
  const raw = firstPerson(argument);
  const tr = looksTurkish(argument, raw);
  const entries = replacements.map((r) => ({
    original: r.original.trim(),
    replacement: r.replacement.trim(),
    label: canonicalLabel(r.replacement.trim()),
  }));
  for (const { original, replacement, label } of entries) {
    if (!original || original === replacement) continue;
    if (!label) {
      push({ original, replacement });
      continue;
    }
    // Names of the OTHER people in the map: "Dana" never becomes "Dan"
    // when Person C is Dan.
    const taken = new Set(
      entries.filter((e) => e.label && e.label !== label).map((e) => bareName(e.original).toLocaleLowerCase("tr")),
    );
    let name = stripGluedSuffix(bareName(original), argument, tr, taken);
    if (!name || canonicalLabel(name)) continue;
    if (label === narrator) {
      // Every narrator becomes "I", which reads as the narrator under
      // either judged language, so a Turkish argument judged with the
      // English interface shows "You", never a person named "Ben". A bare
      // "Ben" only counts when the argument is Turkish: in English it is a
      // name.
      const lower = name.toLocaleLowerCase("tr");
      if (EN_SELF.test(name) || (TR_SELF.has(lower) && (lower !== "ben" || tr))) name = "I";
    }
    push({ original: name, replacement: label });
  }

  if (!out.some((m) => m.replacement === narrator)) {
    const anon = firstPerson(text);
    const present = tr ? raw.trAny + raw.trVerbs > 0 : raw.enAny > 0;
    const labelRe = (label: string) => new RegExp(String.raw`(?:Party|Taraf) ${label.slice(-1)}(?![\p{L}\p{N}])`, "u");
    const hasLabelSelf = labelRe(narrator).test(text);
    const hasLabelOther = labelRe(other).test(text) || out.some((m) => m.replacement === other);
    const rewritten = tr
      ? raw.trStrong > 0
        ? anon.trStrong < raw.trStrong
        : anon.trVerbs < raw.trVerbs || anon.trAny < raw.trAny
      : raw.enStrong > 0
        ? anon.enStrong < raw.enStrong
        : anon.enAny < raw.enAny;
    if (present && ((hasLabelSelf && rewritten) || (!hasLabelSelf && hasLabelOther))) {
      out.unshift({ original: "I", replacement: narrator });
    }
  }
  return out;
}
