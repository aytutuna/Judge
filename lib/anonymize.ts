import { claudeJson, hasApiKey, LITE_MODEL, type Effort } from "./claude";
import { bareName, canonicalLabel, classifyTr, EN_SELF, TR_SELF, trSuffix, type TrCase } from "./names";
import type { NameMapping } from "./types";

export type AnonymizeResult = {
  text: string;
  nameMap: NameMapping[];
};

/** What happened inside one anonymize() call, for diagnostics and probes.
 * Holds no names. */
export type AnonymizeTrace = {
  attempts: number;
  /** Attempts whose text needed names substituted in code. */
  repaired: number;
  /** Why each failed or suspicious attempt was retried or rejected. */
  reasons: string[];
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

/** The firmer instruction for the second attempt. The names come from the
 * first attempt's own list; the candidates are capitalized words of the
 * argument that survived unlisted. */
export function retrySystem(hint: RetryHint): string {
  const lines = [
    SYSTEM,
    "",
    "IMPORTANT: a previous attempt on this text left real names in the output. Rewrite the WHOLE text and replace EVERY occurrence of EVERY person's name, nickname and username, in every form (possessive \"Ryan's\", Turkish suffixes \"Burak'ın\", \"Burak'a\", \"Burakla\"), with that person's label. The rewritten text must not contain any of the original names, and every person you replace must be listed.",
  ];
  if (hint.names.length) lines.push(`Names already found in this text: ${hint.names.join(", ")}.`);
  if (hint.candidates.length) {
    lines.push(
      `Check these capitalized words from the text: ${hint.candidates.join(", ")}. If one is a person's name, nickname or username, replace it with a label and list it; leave every other word as it is.`,
    );
  }
  return lines.join("\n");
}

type ModelOutput = {
  text: string;
  replacements: { original: string; replacement: string }[];
};

export type RetryHint = { names: string[]; candidates: string[] };

type Attempt = {
  repaired: boolean;
  hint: RetryHint;
  /** The person rules this attempt's own list produced. */
  rules: NameRule[];
} & (
  | { ok: true; value: AnonymizeResult; suspicious: string | null }
  | { ok: false; retry: boolean; error: string }
);

/** The whole anonymize step, both attempts, stays inside the 60 s every
 * caller budgets for it; the retry only runs with at least RETRY_MIN_MS
 * left. A typical attempt takes 2-5 s. */
const TOTAL_BUDGET_MS = 60_000;
const ATTEMPT_TIMEOUT_MS = 50_000;
const RETRY_MIN_MS = 10_000;

/**
 * One model call, then the code-side guard:
 * - the model's listed names are substituted in its text (repairs an
 *   un-rewritten echo and names it listed but left in place);
 * - fails (retryable) when a name listed by this or an earlier attempt
 *   still survives, or when names were listed but the text is still
 *   identical to the input;
 * - on the retry, also fails when a word the guard flags as a possible
 *   name survives unlisted in a way that reads as a person (heldCandidates);
 * - flags as suspicious, without failing, capitalized words of the input
 *   that survive unlisted (the model sometimes echoes the input with an
 *   empty list).
 */
async function attempt(
  argument: string,
  effort: Effort,
  hint: RetryHint | null,
  prior: readonly NameRule[],
  timeoutMs: number,
): Promise<Attempt> {
  const res = await claudeJson<ModelOutput>({
    system: hint ? retrySystem(hint) : SYSTEM,
    user: argument,
    schema: SCHEMA,
    effort,
    model: LITE_MODEL,
    // Runs before the judges on every request; a stall here fails the
    // request early instead of holding it for the full judge budget.
    timeoutMs,
  });
  const none = { repaired: false, rules: [] };
  if (!res.ok) {
    const error = res.blocked ? `blocked (${res.reason})` : res.error;
    return { ok: false, retry: false, error, hint: hint ?? { names: [], candidates: [] }, ...none };
  }
  // Structured outputs should guarantee the shape; a missing text would
  // otherwise slip an empty or undefined argument past the judges.
  const data = res.data;
  if (typeof data?.text !== "string" || !data.text.trim() || !Array.isArray(data.replacements)) {
    const error = "anonymizer returned malformed output";
    return { ok: false, retry: true, error, hint: hint ?? { names: [], candidates: [] }, ...none };
  }
  const replacements = data.replacements.filter(
    (r) => typeof r?.original === "string" && typeof r?.replacement === "string",
  );
  const turkish = isTurkishText(argument);
  const rules = nameRules(replacements, turkish, argument);
  const text = substituteNames(data.text, rules, turkish);
  const repaired = text !== data.text;
  const people = rules.filter((r) => r.person);
  const hintOut: RetryHint = {
    names: [...new Set([...prior, ...people].map((r) => r.name))],
    candidates: unlistedCandidates(argument, text, rules, replacements),
  };
  const base = { repaired, hint: hintOut, rules: people };
  if (people.some((r) => r.label) && sameText(text, argument)) {
    return { ok: false, retry: true, error: "output identical to the input", ...base };
  }
  if (findNameLeak(text, [...people, ...prior], turkish)) {
    return { ok: false, retry: true, error: "a listed name survived anonymization", ...base };
  }
  if (hint && heldCandidates(argument, text, hintOut.candidates).length > 0) {
    return { ok: false, retry: true, error: "a flagged name survived unlisted", ...base };
  }
  const nameMap = normalizeNameMap(replacements, argument, text);
  // An untouched first-person text with nobody listed means the model
  // skipped the job: a narrator who is a side always becomes Party A.
  const fp = firstPerson(argument);
  const suspicious = hintOut.candidates.length
    ? "unlisted capitalized words survived"
    : people.length === 0 && sameText(data.text, argument) && fp.enAny + fp.trAny + fp.trVerbs > 0
      ? "output identical to the input"
      : null;
  return { ok: true, value: { text, nameMap }, suspicious, ...base };
}

/**
 * Names -> Party A/B before judging and storage. Doubles as bias mitigation:
 * the judge never sees who is who. The name map is returned to the client for
 * display but never stored. Fails closed: throws AnonymizeError rather than
 * ever returning the raw text or a text that still holds a listed name.
 *
 * Low effort first; one retry at medium effort with a firmer instruction
 * when the output is malformed, a listed name survived the code-side
 * substitution, or capitalized words of the input survived unlisted. The
 * retry must pass the same checks, also against the names the first attempt
 * listed; unlisted words are then accepted (a place, brand or weekday the
 * model chose to keep) unless heldCandidates reads them as a person. A
 * retry that returns the input untouched fails closed when the input has
 * possible names or is in the first person (a narrator who is a side always
 * becomes Party A). A first attempt that was only suspicious is kept when
 * the retry leaks but none of the retry's names is in the first text and
 * none of its own flagged words reads as a person.
 */
export async function anonymize(argument: string, trace?: AnonymizeTrace): Promise<AnonymizeResult> {
  if (!hasApiKey()) {
    // Unreachable via the API route (it refuses without a key).
    throw new AnonymizeError("ANTHROPIC_API_KEY not set");
  }
  const started = Date.now();
  const turkish = isTurkishText(argument);
  let hint: RetryHint | null = null;
  let prior: NameRule[] = [];
  let fallback: AnonymizeResult | null = null;
  let fallbackCandidates: string[] = [];
  let last = "";
  const fp = firstPerson(argument);
  const firstPersonText = fp.enAny + fp.trAny + fp.trVerbs > 0;
  for (let i = 0; i < 2; i++) {
    const left = TOTAL_BUDGET_MS - (Date.now() - started);
    if (i > 0 && left < RETRY_MIN_MS) break;
    const res = await attempt(argument, i === 0 ? "low" : "medium", hint, prior, Math.min(ATTEMPT_TIMEOUT_MS, left));
    if (trace) {
      trace.attempts++;
      if (res.repaired) trace.repaired++;
    }
    if (res.ok && i > 0 && sameText(res.value.text, argument)) {
      // Echoed twice with possible names in it, or with a first-person
      // narrator left as written: never pass that on.
      const why = res.hint.candidates.length > 0 ? "with possible names" : firstPersonText ? "in the first person" : null;
      if (why) {
        trace?.reasons.push(`output identical to the input ${why}`);
        throw new AnonymizeError(`output identical to the input ${why}`);
      }
    }
    if (res.ok) {
      if (!res.suspicious || i > 0) return res.value;
      fallback = res.value;
      fallbackCandidates = res.hint.candidates;
      last = res.suspicious;
    } else {
      last = res.error;
      if (
        fallback &&
        res.retry &&
        res.rules.length > 0 &&
        !findNameLeak(fallback.text, res.rules, turkish) &&
        heldCandidates(argument, fallback.text, fallbackCandidates).length === 0
      ) {
        trace?.reasons.push(last);
        return fallback;
      }
      if (!res.retry) break;
    }
    trace?.reasons.push(last);
    hint = res.hint;
    prior = [...prior, ...res.rules];
    // Reasons only, never names: nothing personal reaches the logs.
    if (i === 0) console.warn(`[anonymize] retry: ${last}`);
  }
  throw new AnonymizeError(last);
}

// --- Code-side substitution and leak check -------------------------------------

/** One name the model listed: what it becomes, and whether it is a person
 * (only people are leak-checked). A person rule without a label is
 * check-only: a surname shared by two people cannot be substituted.
 * - ambiguous: an everyday-word name or one word of a full name; never
 *   lowercase or all-caps, and checked at a sentence start;
 * - part: one word of a full name ("Brown" of "Sarah Brown");
 * - exact: a generalized place or company, matched only as spelled;
 * - lowerOk: lowercase spellings are the name too (the model listed it in
 *   lowercase, or the argument never writes it capitalized). */
type NameRule = {
  name: string;
  label: string | null;
  person: boolean;
  ambiguous: boolean;
  part: boolean;
  exact: boolean;
  lowerOk: boolean;
};

/** Names that are also everyday words in English or Turkish. They are never
 * matched in lowercase, at the start of a sentence only when the next word
 * does not make them the ordinary word ("Can you", "Will it"), and glued
 * suffixes only in the middle of a sentence ("Denize girdik" is the sea). */
const COMMON_WORD_NAMES = new Set([
  // English
  "will", "may", "can", "ben", "mark", "bill", "rose", "grace", "hope", "joy", "faith", "june", "april",
  "august", "art", "jack", "pat", "sue", "rob", "frank", "drew", "hunter", "miles", "dawn", "summer", "iris",
  "lily", "penny", "ruby", "amber", "gene", "rich", "bob", "ray", "sky", "river", "brook", "cliff", "dean",
  "earl", "guy", "nick", "chase", "chance", "chip", "don", "glen", "holly", "ivy", "jade", "jean", "lance",
  "pearl", "reed", "sandy", "skip", "stone", "sunny", "wade", "max", "harmony", "destiny", "honey",
  // Turkish
  "deniz", "umut", "ümit", "barış", "su", "ay", "nur", "gül", "bahar", "yağmur", "kaya", "özgür", "sevgi",
  "mutlu", "onur", "derya", "toprak", "ırmak", "ateş", "yıldız", "güneş", "ceylan", "doğa", "duru", "ekin",
  "pınar", "damla", "kader", "hayat", "sevda", "şeker", "aslan", "kartal", "çiçek", "inci", "mercan", "lale",
  "cemre", "bulut", "ozan", "güven", "emel", "arzu", "hülya", "sevinç", "şafak", "tan", "uğur", "erdem",
  "başak", "demir", "çelik", "berk", "mert", "ilke", "naz", "alev", "oya", "ela", "fidan", "gonca", "serin",
  "sen", "dilek", "yeter", "kara",
]);

/** Lowercase words that are a description, not a name ("roommate" ->
 * Party B is the model labelling a role). */
const RELATION_WORDS = new Set([
  "sister", "brother", "mom", "mum", "dad", "mother", "father", "friend", "boss", "wife", "husband",
  "boyfriend", "girlfriend", "partner", "roommate", "flatmate", "housemate", "coworker", "colleague",
  "manager", "neighbor", "neighbour", "landlord", "landlady", "tenant", "teacher", "cousin", "aunt", "uncle",
  "son", "daughter", "grandma", "grandpa", "kid", "child", "babysitter", "nanny", "client", "customer",
  "seller", "buyer", "spouse", "fiance", "fiancé", "fiancée", "ex",
  "abla", "abi", "ağabey", "anne", "baba", "kardeş", "arkadaş", "eş", "koca", "karı", "sevgili", "patron",
  "müdür", "komşu", "kiracı", "öğretmen", "kuzen", "teyze", "hala", "amca", "dayı", "yenge", "enişte",
  "oğul", "kız", "dede", "nine", "babaanne", "anneanne", "müşteri",
]);

/** Lowercase particles inside a full name ("Ludwig van Beethoven"). */
const NAME_PARTICLES = new Set(["van", "von", "de", "da", "del", "der", "den", "la", "le", "bin", "ibn", "al", "el", "di", "du"]);
/** Titles that are not names on their own ("Ali Bey" -> "Ali"). */
const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "sir", "bey", "hanım", "hoca", "hocam"]);
/** First words that make a capitalized original a description ("My sister"). */
const DESCRIPTOR_START = new Set(["my", "your", "his", "her", "our", "their", "the", "a", "an", "benim", "bizim", "onun", "senin"]);
const LABEL_WORDS = new Set(["party", "person", "taraf", "kişi"]);

/** Words after a sentence-initial ambiguous name that make it the ordinary
 * word ("Can you believe", "Will it rain", "Umut ediyorum"). */
const ORDINARY_NEXT = new Set([
  "you", "i", "we", "they", "he", "she", "it", "this", "that", "these", "those", "the", "a", "an", "someone",
  "somebody", "anyone", "anybody", "everyone", "there", "my", "your", "our", "his", "her", "their", "not",
  "be", "all", "ediyorum", "ediyor", "ederim", "eder", "ettim", "etmek", "kenarı", "kenarında", "kenarına",
  "kenarından", "artık",
]);

/** Cases a suffix glued on without an apostrophe is substituted for in code
 * ("Burakla" -> "Party B'yle"), when it agrees with the name by vowel harmony. */
const TR_SUBSTITUTE_CASES: readonly TrCase[] = ["gen", "acc", "dat", "loc", "abl", "ins"];
/** Any glued tail that reads as a Turkish suffix on a name, regardless of
 * harmony: a name with one of these left after substitution is a leak. */
const TR_LEAK_TAIL =
  /^(?:n?[ıiuü]n(?:ki)?|y?[ıiuü]|y?[ae]|[dt][ae](?:n|ki)?|y?l[ae]|l[ae]r\p{Ll}*|c[ıiuü]ğ?[ıiuü]m|c[ıiuü]m|gil\p{Ll}*)$/u;
/** English contractions after an apostrophe ("Can't", "Will's" is still a
 * possessive): "t" is never a name's suffix. */
const NOT_A_SUFFIX = new Set(["t"]);

/** How a label's letter is read in Turkish, for suffix harmony ("B" -> "be"
 * -> "B'nin", "A" -> "A'nın"). */
const TR_LETTER: Record<string, string> = {
  A: "a", B: "be", C: "ce", D: "de", E: "e", F: "fe", G: "ge", H: "he", I: "ı", J: "je", K: "ke", L: "le",
  M: "me", N: "ne", O: "o", P: "pe", Q: "kü", R: "re", S: "se", T: "te", U: "u", V: "ve", W: "ve", X: "iks",
  Y: "ye", Z: "ze",
};

const letterCount = (s: string) => (s.match(/\p{L}/gu) ?? []).length;
const hasUpper = (s: string) => /\p{Lu}/u.test(s);
const hasLower = (s: string) => /\p{Ll}/u.test(s);
const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/** Whether the argument is Turkish, for suffix handling: the function-word
 * test, or a letter only Turkish uses (ğ, ı, ş, İ). */
function isTurkishText(argument: string): boolean {
  return looksTurkish(argument, firstPerson(argument)) || /[ğışĞİŞ]/u.test(argument);
}

/** Whether an original the model listed reads as a name rather than a
 * description: capitalized tokens (particles allowed), or a single lowercase
 * token that is neither an everyday word nor a role, or a username. */
function nameLike(name: string): boolean {
  const tokens = name.split(/\s+/);
  if (tokens.length === 1) {
    if (/^\p{Lu}/u.test(name)) return true;
    if (/[@_\d]/u.test(name)) return true;
    const lower = name.toLocaleLowerCase("tr");
    return /^\p{L}[\p{L}'’.-]*$/u.test(name) && !COMMON_WORD_NAMES.has(lower) && !RELATION_WORDS.has(lower);
  }
  if (DESCRIPTOR_START.has(tokens[0].toLocaleLowerCase("tr"))) return false;
  return tokens.every((t) => /^\p{Lu}/u.test(t) || NAME_PARTICLES.has(t.toLowerCase()));
}

/** Both lowercase forms of a word: Turkish ("If" -> "ıf") and plain ("if"). */
const lowerForms = (s: string) => [s.toLocaleLowerCase("tr"), s.toLowerCase()];
const inSet = (set: ReadonlySet<string>, s: string) => lowerForms(s).some((w) => set.has(w));

/** Whether the argument ever writes the name capitalized ("Burak"; an
 * all-caps "BURAK" is emphasis, not how the user spells names). */
function writtenCapitalized(argument: string, name: string): boolean {
  for (const m of argument.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])(?:${namePattern(name)})`, "gu"))) {
    if (/^\p{Lu}/u.test(m[0]) && hasLower(m[0])) return true;
  }
  return false;
}

type RuleKind = "name" | "part" | "place";

function makeRule(name: string, label: string | null, person: boolean, kind: RuleKind, argument?: string): NameRule {
  const part = kind === "part";
  const ambiguous = part || inSet(COMMON_WORD_NAMES, name);
  const typedLower = !hasUpper(name) || (argument !== undefined && !writtenCapitalized(argument, name));
  return {
    name,
    label,
    person,
    ambiguous,
    part,
    exact: kind === "place",
    lowerOk: kind === "name" && !ambiguous && !inSet(RELATION_WORDS, name) && typedLower,
  };
}

/**
 * The model's replacement list as substitution rules. Skipped: labels, the
 * narrator's pronouns ("I", "me"; "Ben" and other first-person forms only in
 * a Turkish argument, where "Ben" is never a name), second-person pronouns,
 * descriptions ("my sister") and one-letter originals. A full name also
 * yields rules for its own words ("Burak" from "Burak Yılmaz"); a word shared
 * by two people becomes check-only. Lowercase spellings only count for a
 * name the model listed in lowercase or the argument (when given) never
 * capitalizes, so "Sarah Brown" leaves a "brown couch" alone. Pure; exported
 * for tests.
 */
export function nameRules(
  replacements: readonly { original: string; replacement: string }[],
  turkish: boolean,
  argument?: string,
): NameRule[] {
  const rules: NameRule[] = [];
  const tokens: { name: string; label: string }[] = [];
  for (const r of replacements) {
    const name = bareName(r.original);
    const target = r.replacement.trim();
    if (letterCount(name) < 2 || !target) continue;
    if (canonicalLabel(name) || LABEL_WORDS.has(name.toLocaleLowerCase("tr"))) continue;
    const lower = name.toLocaleLowerCase("tr");
    if (EN_SELF.test(name) || TR_SECOND_PERSON.has(lower)) continue;
    if (TR_SELF.has(lower) && (lower !== "ben" || turkish)) continue;
    if (!nameLike(name)) continue;
    const label = canonicalLabel(target);
    if (!label) {
      // A place or company the model generalized: substituted, not checked.
      if (target !== name && /^\p{Lu}/u.test(name)) rules.push(makeRule(name, target, false, "place"));
      continue;
    }
    rules.push(makeRule(name, label, true, "name", argument));
    const parts = name.split(/\s+/);
    if (parts.length > 1) {
      for (const p of parts) {
        if (letterCount(p) >= 3 && /^\p{Lu}/u.test(p) && !TITLES.has(p.toLocaleLowerCase("tr").replace(/\.$/, ""))) {
          tokens.push({ name: p, label });
        }
      }
    }
  }
  const key = (s: string) => s.toLocaleLowerCase("tr");
  const full = new Map(rules.map((r) => [key(r.name), r]));
  for (const t of tokens) {
    if (full.has(key(t.name))) continue;
    const labels = new Set(tokens.filter((o) => key(o.name) === key(t.name)).map((o) => o.label));
    full.set(key(t.name), makeRule(t.name, labels.size === 1 ? t.label : null, true, "part"));
    rules.push(full.get(key(t.name))!);
  }
  // Dedupe: the first rule for a name wins.
  const seen = new Set<string>();
  return rules.filter((r) => {
    if (seen.has(key(r.name))) return false;
    seen.add(key(r.name));
    return true;
  });
}

/** A regex class for one character of a name in any case; the four Turkish
 * and Latin i's are one class, since locale case mapping mixes them. */
function charClass(ch: string): string {
  if (/[iİıI]/u.test(ch)) return "[iİıI]";
  if (ch === "'" || ch === "’") return "['’]";
  const set = new Set(
    [ch, ch.toLowerCase(), ch.toUpperCase(), ch.toLocaleLowerCase("tr"), ch.toLocaleUpperCase("tr")].filter(
      (c) => [...c].length === 1,
    ),
  );
  return set.size === 1 ? escapeRe(ch) : `[${[...set].map(escapeRe).join("")}]`;
}

function namePattern(name: string): string {
  return name
    .split(/\s+/)
    .map((t) => [...t].map(charClass).join(""))
    .join("\\s+");
}

type Occurrence = {
  rule: NameRule;
  /** The matched name, without suffix. */
  name: string;
  apos: string;
  suffix: string | undefined;
  glued: string | undefined;
  index: number;
  length: number;
};

/** Every place a rule's name appears as a whole word, with an optional
 * apostrophe suffix or a glued lowercase tail. Not after an apostrophe
 * (that is a suffix) and never inside a longer word. */
function occurrences(text: string, rules: readonly NameRule[]): Occurrence[] {
  if (rules.length === 0) return [];
  const sorted = [...rules].sort((a, b) => b.name.length - a.name.length);
  const patterns = sorted.map((r) => ({ rule: r, re: new RegExp(`^(?:${namePattern(r.name)})$`, "u") }));
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}'’])(${sorted.map((r) => namePattern(r.name)).join("|")})(?:(['’])(\\p{Ll}+)|(\\p{Ll}+))?(?![\\p{L}\\p{N}])`,
    "gu",
  );
  const out: Occurrence[] = [];
  for (const m of text.matchAll(re)) {
    const rule = patterns.find((p) => p.re.test(m[1]))?.rule;
    if (!rule) continue;
    out.push({ rule, name: m[1], apos: m[2] ?? "", suffix: m[3], glued: m[4], index: m.index, length: m[0].length });
  }
  return out;
}

/** Whether an occurrence is the person and not an ordinary word: a
 * generalized place only as spelled; a lowercase spelling only for a
 * lowerOk rule, or with a Turkish case after an apostrophe ("deniz'e" is
 * never the sea); for an ambiguous rule not an all-caps word, not a
 * contraction ("Can't") and not the ordinary word opening a sentence ("Can
 * you", or "Long story" when the text also writes "long"). */
function isNameUse(o: Occurrence, text: string): boolean {
  if (o.suffix !== undefined && NOT_A_SUFFIX.has(o.suffix)) return false;
  if (o.rule.exact) return o.name.replace(/\s+/g, " ") === o.rule.name.replace(/\s+/g, " ");
  if (!hasUpper(o.name)) {
    return o.rule.lowerOk || (o.rule.person && o.suffix !== undefined && classifyTr(o.suffix) !== null);
  }
  if (!o.rule.ambiguous) return true;
  if (!hasLower(o.name) && hasLower(o.rule.name)) return false;
  if (o.suffix !== undefined || midSentence(text, o.index)) return true;
  if (o.rule.part && lowerForms(o.name).some((w) => wordIn(text, w))) return false;
  const next = /^\s+(\p{L}+)/u.exec(text.slice(o.index + o.length));
  return !(next && inSet(ORDINARY_NEXT, next[1]));
}

/** Whether `word` appears in `text` as a whole word, exactly as spelled. */
const wordIn = (text: string, word: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}'’])${escapeRe(word)}(?![\\p{L}\\p{N}])`, "u").test(text);

/** Whether a glued tail ("Burakla") is the name with a suffix: Turkish text,
 * a capitalized letters-only name of 3+ letters, the whole word not a
 * pronoun, and for an everyday-word name only mid-sentence. */
function gluedNameUse(o: Occurrence, text: string, turkish: boolean): boolean {
  if (!turkish || !o.rule.person || o.glued === undefined) return false;
  if (!/^\p{L}+$/u.test(o.name) || letterCount(o.name) < 3 || !/^\p{Lu}/u.test(o.name)) return false;
  const word = (o.name + o.glued).toLocaleLowerCase("tr");
  if (TR_SELF.has(word) || TR_SECOND_PERSON.has(word)) return false;
  if (o.rule.ambiguous && !midSentence(text, o.index)) return false;
  return true;
}

/** The suffix for a label after an apostrophe: a Turkish case re-harmonized
 * for the label's letter ("Burak'ın" -> "Party B'nin"), anything else kept
 * as written ("Ryan's" -> "Party B's"). */
function labelSuffix(label: string, suffix: string): string {
  if (suffix === "s") return suffix;
  const c = classifyTr(suffix);
  const spoken = canonicalLabel(label) ? TR_LETTER[label.slice(-1)] : undefined;
  if (!c || !spoken) return suffix;
  return trSuffix(spoken, c) ?? suffix;
}

/**
 * Applies the rules to the text in one pass: whole words, case variants,
 * apostrophe suffixes kept (Turkish ones re-harmonized for the label), and
 * in Turkish text a glued case suffix that agrees with the name by vowel
 * harmony ("Burakla" -> "Party B'yle"). Everyday-word names are left alone
 * where they read as the ordinary word. Pure; exported for tests.
 */
export function substituteNames(text: string, rules: readonly NameRule[], turkish: boolean): string {
  const active = rules.filter((r) => r.label);
  let out = "";
  let pos = 0;
  for (const o of occurrences(text, active)) {
    const label = o.rule.label!;
    let replacement: string | null = null;
    if (o.glued === undefined) {
      if (isNameUse(o, text)) replacement = o.suffix === undefined ? label : `${label}${o.apos}${labelSuffix(label, o.suffix)}`;
    } else if (gluedNameUse(o, text, turkish) && canonicalLabel(label)) {
      const word = o.name + o.glued;
      // "Dana'ya" elsewhere proves "Dana" is someone else, not "Dan" + "-a".
      const ownName = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}['’]\\p{Ll}`, "u").test(text);
      const c = TR_SUBSTITUTE_CASES.find((k) => trSuffix(o.rule.name, k) === o.glued);
      const spoken = TR_LETTER[label.slice(-1)];
      if (c && !ownName && spoken) replacement = `${label}'${trSuffix(spoken, c) ?? o.glued}`;
    }
    if (replacement === null) continue;
    out += text.slice(pos, o.index) + replacement;
    pos = o.index + o.length;
  }
  return out + text.slice(pos);
}

/**
 * Whether a listed person's name is still in the text: as a whole word in a
 * name use (any case variant, apostrophe suffix or not), or in Turkish text
 * with any glued suffix ("Burakın", "Buraklar"). Label text never matches
 * (names are 2+ letters, labels end in one capital letter). Pure; exported
 * for tests.
 */
export function findNameLeak(text: string, rules: readonly NameRule[], turkish: boolean): boolean {
  for (const o of occurrences(text, rules.filter((r) => r.person))) {
    if (o.glued === undefined ? isNameUse(o, text) : gluedNameUse(o, text, turkish) && TR_LEAK_TAIL.test(o.glued)) {
      return true;
    }
  }
  return false;
}

/** Capitalized words that are not names of anyone: calendar, languages,
 * holidays, platforms, family words used as names, labels. */
const NOT_NAMES = new Set(
  [
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
    "november", "december", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım",
    "aralık", "pazartesi", "salı", "çarşamba", "perşembe", "cuma", "cumartesi", "pazar",
    "christmas", "easter", "thanksgiving", "halloween", "ramadan", "ramazan", "bayram", "eid", "hanukkah",
    "diwali", "valentine", "english", "turkish", "american", "british", "german", "french", "spanish",
    "italian", "european", "türk", "türkçe", "ingilizce", "almanca", "fransızca", "god", "allah", "tanrı",
    "mom", "mum", "dad", "mommy", "mummy", "daddy", "grandma", "grandpa", "granny", "anne", "baba", "annem",
    "babam", "mr", "mrs", "ms", "dr", "bey", "hanım", "ok", "okay", "tv", "party", "person", "taraf", "kişi",
    "uber", "netflix", "amazon", "google", "instagram", "whatsapp", "facebook", "iphone", "android", "venmo",
    "paypal", "airbnb", "spotify", "youtube", "tiktok", "twitter", "discord", "slack", "zoom", "excel",
    "powerpoint", "ikea", "playstation", "xbox", "nintendo", "lego", "starbucks", "mcdonald's",
  ].map((w) => w.toLocaleLowerCase("tr")),
);

/** Words that commonly open a sentence and are never a name on their own. */
const SENTENCE_OPENERS = new Set([
  // English
  "he", "she", "it", "we", "they", "you", "me", "this", "that", "these", "those", "there", "here", "the", "an",
  "my", "your", "his", "her", "our", "their", "its", "and", "but", "or", "so", "yet", "nor", "because", "since",
  "as", "if", "when", "whenever", "while", "after", "before", "then", "now", "later", "also", "still", "even",
  "just", "only", "well", "oh", "yes", "yeah", "no", "nope", "not", "never", "always", "sometimes", "often",
  "usually", "today", "yesterday", "tomorrow", "tonight", "last", "next", "every", "each", "all", "both",
  "some", "any", "most", "many", "much", "one", "two", "three", "four", "five", "first", "second", "third",
  "finally", "anyway", "basically", "honestly", "actually", "apparently", "obviously", "clearly",
  "recently", "eventually", "meanwhile", "however", "although", "though", "unless", "until", "what",
  "whatever", "who", "why", "how", "where", "which", "whose", "is", "are", "was", "were", "do", "does",
  "did", "don't", "have", "has", "had", "should", "would", "could", "shall", "must", "might", "can", "will",
  "may", "let", "please", "thanks", "sorry", "hi", "hello", "hey", "dear", "edit", "update", "in", "on", "at",
  "for", "from", "with", "without", "about", "to", "of", "by", "over", "under", "during", "between",
  "instead", "plus", "once", "again", "otherwise", "besides", "nobody", "everyone", "everybody", "someone",
  "somebody", "anyone", "anybody", "nothing", "everything", "something", "anything", "neither", "either",
  "other", "another", "such", "mine", "myself", "like", "maybe", "perhaps", "unfortunately", "luckily",
  "sadly", "suddenly", "thus", "therefore", "lol", "ok", "okay", "nowadays", "lately", "originally",
  "initially", "afterwards",
  // Turkish
  "bu", "şu", "o", "bunu", "şunu", "onu", "buna", "şuna", "ona", "bunun", "onun", "bunlar", "onlar", "ama",
  "fakat", "ancak", "ve", "veya", "ya", "yani", "çünkü", "sonra", "önce", "dün", "bugün", "yarın", "şimdi",
  "artık", "hep", "hiç", "her", "bir", "iki", "üç", "hem", "ne", "neden", "niye", "nasıl", "kim", "kimse",
  "hangi", "nerede", "biz", "siz", "evet", "hayır", "tamam", "peki", "belki", "aslında", "zaten", "sadece",
  "bile", "hatta", "mesela", "örneğin", "geçen", "gelecek", "bazen", "genelde", "sonunda", "sonuçta",
  "yine", "gene", "halbuki", "oysa", "eğer", "madem", "kendisi", "kendi", "birlikte", "beraber", "ayrıca",
  "üstelik", "böyle", "şöyle", "öyle", "daha", "en", "çok", "az", "biraz", "herkes", "hepsi", "hepimiz",
  "bizim", "sizin", "onların", "ilk", "son", "bazı", "birkaç", "burada", "orada", "sanki", "galiba",
  "herhalde", "gerçekten", "açıkçası", "kısacası", "ondan", "bundan", "merhaba", "selam", "lütfen", "için",
  "gibi", "kadar", "olay", "durum", "konu",
]);

const hasBothLabels = (text: string) => /Party A(?![\p{L}\p{N}])/u.test(text) && /Party B(?![\p{L}\p{N}])/u.test(text);

/** Whole-word uses of a capitalized word in the argument, with the apostrophe
 * suffix each one carries. */
function usesOf(argument: string, word: string): (string | undefined)[] {
  const re = new RegExp(`(?<![\\p{L}\\p{N}'’])${escapeRe(word)}(?:['’](\\p{Ll}+))?(?![\\p{L}\\p{N}])`, "gu");
  return [...argument.matchAll(re)].map((m) => m[1]);
}

/** Whether a capitalized word that only opens a sentence reads as a possible
 * name: not a common opener, not followed by the word that makes an
 * everyday name ordinary ("Can you"), never written in lowercase in the
 * argument, and either used twice or left in a text that lacks Party A or
 * Party B (an echo, or a rewrite that missed a side). */
function sentenceStartName(argument: string, text: string, word: string, index: number): boolean {
  if (inSet(SENTENCE_OPENERS, word)) return false;
  const next = /^\s+(\p{L}+)/u.exec(argument.slice(index + word.length));
  if (next && inSet(ORDINARY_NEXT, next[1])) return false;
  if (lowerForms(word).some((w) => wordIn(argument, w))) return false;
  return usesOf(argument, word).length >= 2 || !hasBothLabels(text);
}

/**
 * Candidates the retry left in a text that lacks Party A or Party B and that
 * read as a person: used with a possessive or a Turkish case suffix, or more
 * than once in the argument. A text with both labels has both sides
 * anonymized; a word left there is a place or brand the model kept
 * ("İstanbul'da" always carries a suffix). Pure; exported for tests.
 */
export function heldCandidates(argument: string, text: string, candidates: readonly string[]): string[] {
  if (hasBothLabels(text)) return [];
  return candidates.filter((c) => {
    if (!wordIn(text, c)) return false;
    const uses = usesOf(argument, c);
    return uses.length >= 2 || uses.some((s) => s !== undefined && (s === "s" || classifyTr(s) !== null));
  });
}

/**
 * Capitalized words of the argument that survive in the rewritten text and
 * that no rule covers: possible names the model neither replaced nor
 * listed. Counted when used mid-sentence, with a Turkish case suffix
 * ("Daniel'in"), or at a sentence start when sentenceStartName says so.
 * Includes names the model "replaced" with themselves. At most 8, in order.
 * Pure; exported for tests.
 */
export function unlistedCandidates(
  argument: string,
  text: string,
  rules: readonly NameRule[],
  replacements: readonly { original: string; replacement: string }[] = [],
): string[] {
  const covered = new Set(rules.map((r) => r.name.toLocaleLowerCase("tr")));
  const out: string[] = [];
  const add = (word: string) => {
    const lower = word.toLocaleLowerCase("tr");
    if (out.includes(word) || covered.has(lower) || inSet(NOT_NAMES, word) || TR_SELF.has(lower) || out.length >= 8) return;
    if (!wordIn(text, word)) return;
    out.push(word);
  };
  for (const r of replacements) {
    const name = bareName(r.original);
    if (name === r.replacement.trim() && /^\p{Lu}\p{Ll}/u.test(name) && !canonicalLabel(name) && !EN_SELF.test(name)) {
      add(name);
    }
  }
  for (const m of argument.matchAll(/(?<![\p{L}\p{N}'’])(\p{Lu}\p{Ll}+)(['’]\p{Ll}+)?(?![\p{L}\p{N}])/gu)) {
    // "It's" and "Shouldn't" are contractions.
    if (m[2] && NOT_A_SUFFIX.has(m[2].slice(1))) continue;
    if (midSentence(argument, m.index) || (m[2] && classifyTr(m[2].slice(1)))) add(m[1]);
    else if (m[2] === undefined || m[2].slice(1) === "s") {
      if (sentenceStartName(argument, text, m[1], m.index)) add(m[1]);
    }
  }
  return out;
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
): NameMapping[] {
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
    if (label === "Party A") {
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

  if (!out.some((m) => m.replacement === "Party A")) {
    const anon = firstPerson(text);
    const present = tr ? raw.trAny + raw.trVerbs > 0 : raw.enAny > 0;
    const hasLabelA = /(?:Party|Taraf) A(?![\p{L}\p{N}])/u.test(text);
    const hasLabelB =
      /(?:Party|Taraf) B(?![\p{L}\p{N}])/u.test(text) || out.some((m) => m.replacement === "Party B");
    const rewritten = tr
      ? raw.trStrong > 0
        ? anon.trStrong < raw.trStrong
        : anon.trVerbs < raw.trVerbs || anon.trAny < raw.trAny
      : raw.enStrong > 0
        ? anon.enStrong < raw.enStrong
        : anon.enAny < raw.enAny;
    if (present && ((hasLabelA && rewritten) || (!hasLabelA && hasLabelB))) {
      out.unshift({ original: "I", replacement: "Party A" });
    }
  }
  return out;
}
