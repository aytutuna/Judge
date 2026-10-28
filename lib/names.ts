import { t, type Lang } from "./i18n";
import { verdictLang } from "./content-lang";
import type { NameMapping, VerdictResult } from "./types";

/**
 * Turkish first-person forms. Matched with toLocaleLowerCase("tr") — never a
 * case-insensitive regex (JS simple case folding excludes U+0130, so /benim/i
 * misses an all-caps "BENİM") and never a case-sensitive lowercase match (the
 * anonymizer reports a genuine narrator's sentence-initial "Ben" capitalized).
 */
export const TR_SELF: ReadonlySet<string> = new Set([
  "ben",
  "bence",
  "benim",
  "bana",
  "beni",
  "bende",
  "benden",
  "benimle",
  "bendeki",
  "benimki",
  "kendim",
  "kendime",
  "kendimi",
  "kendimden",
]);

export const EN_SELF = /^(i|me|my|mine|myself)$/i;

// --- Labels and bare names ----------------------------------------------------

/** A party or placeholder label, in either language, with an optional
 * leftover suffix ("Taraf B'ye", "Party A's"). */
const LABEL = /^(?:(?:party|taraf)\s+([ab])|(?:person|kişi)\s+([c-z]))(?:['’]\p{L}*)?$/iu;

/** Canonical label for an anonymizer replacement ("taraf b'ye" -> "Party B",
 * "Kişi C" -> "Person C"), or null when it is not a person label. */
export function canonicalLabel(replacement: string): string | null {
  const m = LABEL.exec(replacement.trim());
  if (!m) return null;
  return m[1] ? `Party ${m[1].toUpperCase()}` : `Person ${m[2].toUpperCase()}`;
}

/** The letter of a label ("Party B" -> "B"), or null. */
function labelLetter(replacement: string): string | null {
  const label = canonicalLabel(replacement);
  return label ? label.slice(-1) : null;
}

/**
 * A name as the anonymizer may report it, minus a Turkish case suffix or an
 * English possessive after an apostrophe ("Deniz'in", "Deniz’e", "Mark's" ->
 * "Deniz", "Deniz", "Mark"). A suffix is lowercase by definition, so
 * "O'Brien" stays whole; a one-letter base ("D'angelo") is never cut.
 */
export function bareName(original: string): string {
  const s = original.trim().replace(/^["“”«»]+|["“”«»]+$/g, "").trim();
  const m = /^(.*\p{L}.*\p{L}|\p{L}{2,})['’]\p{Ll}{1,10}$/u.exec(s);
  return m ? m[1] : s;
}

/** Whether an original is the narrator's pronoun under the judged language
 * ("I", "me"; "Ben", "bana" only for a Turkish argument). */
export function isSelfOriginal(original: string, selfLang: Lang): boolean {
  return EN_SELF.test(original) || (selfLang === "tr" && TR_SELF.has(original.toLocaleLowerCase("tr")));
}

const startsUpper = (s: string) => /^\p{Lu}/u.test(s);

export type Party = { name: string; self: boolean };
/** Label letter ("A", "B", "C"…) -> who it stands for. */
export type Parties = ReadonlyMap<string, Party>;

/** Which party label is the viewer's own narrator. "A" everywhere except a
 * two-sided case seen by the person who answered the invite: their own
 * account was anonymized with them as Party B. */
export type SelfParty = "A" | "B";

/** `noSelf`: no entry is the narrator. Share pages restore the writer's
 * chosen display names this way, so nobody is called "You" there and a
 * display name such as "Ben" stays a name. */
export type NameOptions = { noSelf?: boolean };

/**
 * Who each label stands for. The pronoun -> narrator mapping applies ONLY to
 * the narrator's slot (`selfParty`, Party A unless a respondent is viewing
 * their own case): the anonymizer's own contract says a first-person
 * narrator is always that party, which protects a friend actually named
 * "Ben" (a top-100 English name) who lands in the other slot. The Turkish
 * set additionally applies only when the argument was judged in Turkish, so
 * an English session about Ben never becomes "You". A narrator pronoun on a
 * "Person C".."Person Z" label (a bystander narrator the anonymizer made a
 * third person) is not a name and is skipped, so nobody is called "Ben" or
 * "I"; the label stays. The two party slots keep the slot guard above.
 * A narrator entry wins its slot; for names the first capitalized entry
 * wins (the anonymizer
 * lists them in order of appearance, so the fullest form usually comes
 * first, and it may also list a description such as "my roommate" for the
 * same slot).
 */
export function resolveParties(
  nameMap: NameMapping[] | undefined,
  selfLang: Lang,
  selfParty: SelfParty = "A",
  opts: NameOptions = {},
): Map<string, Party> {
  const parties = new Map<string, Party>();
  for (const m of nameMap ?? []) {
    const letter = labelLetter(m.replacement);
    if (!letter) continue;
    const name = bareName(m.original);
    if (!name) continue;
    const current = parties.get(letter);
    const selfWord = !opts.noSelf && isSelfOriginal(name, selfLang);
    if (selfWord && letter === selfParty) {
      parties.set(letter, { name, self: true });
    } else if (selfWord && letter !== "A" && letter !== "B") {
      continue;
    } else if (!current || (!current.self && !startsUpper(current.name) && startsUpper(name))) {
      // A capitalized name beats a lowercase description ("my roommate").
      parties.set(letter, { name, self: false });
    }
  }
  return parties;
}

/**
 * Derive display names for the two parties from the anonymization map.
 * First-person narrators become You/Sen.
 *
 * The self flags are the STRUCTURAL trigger for second-person grammar —
 * never detect "you" by string-comparing display names (the tr name is
 * "Sen", and default-locale toLowerCase mangles İ in real names like
 * "İrem").
 *
 * `lang` is the display language of the labels; `selfLang` is the language
 * the argument was judged in (defaults to `lang`). They differ when a
 * verdict is shown translated: a Turkish "Ben" stays the narrator, labelled
 * "You", after the page switches to English.
 *
 * `selfParty` "B" is the respondent's own view of a two-sided case: their
 * narrator entry ({ original: "I", replacement: "Party B" }) makes Party B
 * "You" and `bIsSelf` true. With the default "A", `bIsSelf` is always false.
 *
 * `viewerKnown` says the viewer is known to be `selfParty` (a case page,
 * where the server says which party is looking). When the map says nothing
 * about that party (the names live on another device), it is labelled
 * "Party A (you)" and flagged as self, so the card still tells the viewer
 * which side they are. Never set on share pages.
 */
export function partyNames(
  nameMap: NameMapping[] | undefined,
  lang: Lang = "en",
  selfLang: Lang = lang,
  selfParty: SelfParty = "A",
  viewerKnown = false,
  opts: NameOptions = {},
): { nameA: string; nameB: string; aIsSelf: boolean; bIsSelf: boolean } {
  const parties = resolveParties(nameMap, selfLang, selfParty, opts);
  const a = parties.get("A");
  const b = parties.get("B");
  const viewerLabel = (letter: SelfParty) =>
    t(lang, "party.youLabel", { label: t(lang, letter === "A" ? "party.a" : "party.b") });
  const markA = viewerKnown && selfParty === "A" && !a;
  const markB = viewerKnown && selfParty === "B" && !b;
  return {
    nameA: a ? (a.self ? t(lang, "you") : a.name) : markA ? viewerLabel("A") : t(lang, "party.a"),
    nameB: b ? (b.self ? t(lang, "you") : b.name) : markB ? viewerLabel("B") : t(lang, "party.b"),
    aIsSelf: Boolean(a?.self) || markA,
    bIsSelf: Boolean(b?.self) || markB,
  };
}

// --- Turkish suffixes on a name -------------------------------------------------

export type TrCase = "gen" | "genki" | "acc" | "dat" | "loc" | "locki" | "abl" | "ins" | "cop" | "past" | "ken" | "evid";

/** A suffix after a label's or a name's apostrophe ("A'nın", "B'ye",
 * "Burak'ın"), read back as a grammatical case. */
const TR_CASES: readonly [RegExp, TrCase][] = [
  [/^n?[ıiuü]nki$/, "genki"],
  [/^n?[ıiuü]n$/, "gen"],
  [/^y?[ıiuü]$/, "acc"],
  [/^y?[ae]$/, "dat"],
  [/^[dt][ae]ki$/, "locki"],
  [/^[dt][ae]n$/, "abl"],
  [/^[dt][ae]$/, "loc"],
  [/^y?l[ae]$/, "ins"],
  [/^[dt][ıiuü]r$/, "cop"],
  [/^y?[dt][ıiuü]$/, "past"],
  [/^y?ken$/, "ken"],
  [/^y?m[ıiuü]ş$/, "evid"],
];

export function classifyTr(suffix: string): TrCase | null {
  const s = suffix.toLocaleLowerCase("tr");
  for (const [re, c] of TR_CASES) if (re.test(s)) return c;
  return null;
}

const VOWELS = "aeıioöuüâîû";
const isVowel = (ch: string) => VOWELS.includes(ch);
/** Voiceless consonants: a following d of the locative/ablative/copula turns t. */
const VOICELESS = "fstkçşhp";

/** Names whose final "l" is palatal, so suffixes take front vowels despite a
 * back last vowel ("Kemal'in", not "Kemal'ın"). */
const PALATAL_L = new Set(["kemal", "cemal", "celal", "hilal", "bilal", "nihal", "meral", "hayal", "celâl", "kemâl"]);

/**
 * The Turkish suffix for `name` in grammatical case `c`, by vowel harmony
 * on the name's last vowel, a buffer consonant after a final vowel, and d->t
 * after a voiceless consonant. Proper names keep their final consonant
 * (Burak'a, never Burağ'a). Null when the name has no vowel to harmonise
 * with ("JJ"): the caller then keeps the label rather than guess.
 */
export function trSuffix(name: string, c: TrCase): string | null {
  const lower = name.trim().toLocaleLowerCase("tr");
  const letters = [...lower].filter((ch) => /\p{L}/u.test(ch));
  const last = letters.at(-1);
  if (!last) return null;
  let v = [...letters].reverse().find(isVowel);
  if (!v) return null;
  const lastWord = lower.split(/\s+/).at(-1) ?? lower;
  if (PALATAL_L.has(lastWord)) v = "e";
  const back = "aıouâû".includes(v);
  const a2 = back ? "a" : "e";
  const i4 = "aıâ".includes(v) ? "ı" : "eiî".includes(v) ? "i" : "ouû".includes(v) ? "u" : "ü";
  const endV = isVowel(last);
  const d = VOICELESS.includes(last) ? "t" : "d";
  const y = endV ? "y" : "";
  switch (c) {
    case "gen":
      return (endV ? "n" : "") + i4 + "n";
    case "genki":
      return (endV ? "n" : "") + i4 + "nki";
    case "acc":
      return y + i4;
    case "dat":
      return y + a2;
    case "loc":
      return d + a2;
    case "locki":
      return d + a2 + "ki";
    case "abl":
      return d + a2 + "n";
    case "ins":
      return y + "l" + a2;
    case "cop":
      return d + i4 + "r";
    case "past":
      return endV ? "yd" + i4 : d + i4;
    case "ken":
      return y + "ken";
    case "evid":
      return y + "m" + i4 + "ş";
  }
}

// --- Restoring names in verdict text ---------------------------------------------

/** A label in running text, with an optional suffix after an apostrophe.
 * Both languages' labels are recognised in both languages: judges and
 * translations occasionally leave the other language's label behind. */
const LABEL_IN_TEXT = /(?<![\p{L}\p{N}])(Party|Taraf|Person|Kişi) ([A-Z])(?:(['’])(\p{Ll}+))?(?![\p{L}\p{N}])/gu;

/** Whether the text before a position ends a sentence (or is empty). */
function atSentenceStart(before: string): boolean {
  const b = before.replace(/["“”‘'«(\[]+$/u, "").trimEnd();
  return b === "" || /[.!?…]["”’»)]*$/u.test(b);
}

function capitalize(s: string, lang: Lang): string {
  return s.charAt(0).toLocaleUpperCase(lang === "tr" ? "tr" : "en") + s.slice(1);
}

// English narrator: "you", with the verb right after it agreeing.

const EN_BE_HAVE: Record<string, string> = { is: "are", was: "were", has: "have", does: "do" };

/** Words right after a subject that need no agreement: modals and pasts. */
const EN_NEUTRAL_NEXT = new Set([
  "can", "cannot", "could", "will", "would", "should", "might", "must", "may", "shall",
  "did", "had", "said", "told", "made", "took", "got", "saw", "knew", "thought", "felt", "left",
  "paid", "spent", "kept", "held", "went", "came", "gave", "put", "ran", "won", "lost", "meant",
  "chose", "forgot", "understood", "bought", "brought", "sent", "wrote", "began", "let", "set",
  // Already plural: only reachable when the label is half of "X and Party A".
  "are", "were", "have", "do", "and", "or",
]);

/** The same, before "n't". */
const EN_NEUTRAL_NEG = new Set([
  "ca", "wo", "could", "would", "should", "might", "must", "did", "had", "are", "were", "have", "do",
]);

/** Words right after a label that make it an object: a determiner never
 * follows a subject ("Party B owes Party A an apology"). */
const EN_OBJECT_NEXT = new Set([
  "a", "an", "the", "some", "any", "no", "this", "that", "these", "those", "his", "her", "their",
  "its", "our", "lots", "nothing", "something", "anything", "everything",
]);

/** Words before a label that make it the subject of what follows. */
const EN_SUBJECT_INTRO = new Set([
  "and", "but", "or", "because", "since", "while", "whereas", "although", "though", "if", "when",
  "unless", "that", "so", "until", "whether", "where", "what", "who", "which", "once", "than",
  "says", "said", "thinks", "thought", "believes", "believed", "argues", "argued", "claims",
  "claimed", "feels", "felt", "insists", "insisted", "admits", "admitted", "knows", "knew",
  "assumes", "assumed", "expects", "expected", "means", "shows", "suggests", "both", "either",
]);

/** Words before a label that make it an object: no verb follows it. */
const EN_PREPOSITIONS = new Set([
  "to", "for", "with", "about", "of", "from", "at", "on", "by", "against", "toward", "towards",
  "like", "unlike", "over", "behind", "without", "within", "into", "onto", "upon", "under",
  "around", "near", "beside", "via", "per", "between", "among",
]);

/** Common verbs whose -s form is safe to lower to "you" + base form even in
 * an object-looking slot ("the thing Party A wants"). */
const EN_COMMON_VERBS = new Set([
  "want", "think", "say", "claim", "argue", "believe", "feel", "know", "need", "agree", "insist",
  "admit", "win", "lose", "make", "take", "get", "see", "expect", "assume", "care", "prefer",
  "mean", "try", "deserve", "point", "focus", "rely", "ignore", "refuse", "accept", "seem",
  "value", "keep", "treat", "hold", "notice", "mention", "suggest", "show", "prove", "ask",
  "promise", "plan", "choose", "decide", "understand", "remember", "forget", "worry", "help",
  "pay", "spend", "leave", "stay", "work", "call", "use", "count", "describe", "consider",
  "wish", "hope", "like", "love", "hate", "do", "go", "have", "stop", "start", "miss", "owe",
  "blame", "lie", "win", "deny", "admit", "apologize", "apologise", "complain", "object",
]);

/** -s words that are never a third-person verb after a subject. */
const EN_NOT_VERBS = new Set([
  "always", "perhaps", "sometimes", "nevertheless", "towards", "its", "this", "his", "hers",
  "yours", "unless", "whereas", "across", "plus", "thus", "versus", "yes", "besides",
  "afterwards", "nowadays", "regardless", "less", "was", "is", "has", "does", "as",
  "himself", "herself", "itself", "themselves", "ourselves", "yourselves", "nonetheless",
]);

/** Base form of a third-person -s verb, or null when the word is not one. */
function enBaseForm(word: string): string | null {
  const w = word.toLowerCase();
  if (w.length < 3 || EN_NOT_VERBS.has(w) || !w.endsWith("s")) return null;
  if (w === "goes") return "go";
  if (w === "focuses") return "focus";
  if (/ies$/.test(w)) return w.length > 4 ? w.slice(0, -3) + "y" : w.slice(0, -1);
  if (/(?:ss|sh|ch|x|zz|o)es$/.test(w)) return w.slice(0, -2);
  if (/(?:ss|us|is|as|os|'s|’s)$/.test(w)) return null;
  return w.slice(0, -1);
}

/** A known verb's third-person form ("wants", "tries"), as its base form. */
function enKnownVerb(word: string): string | null {
  const base = enBaseForm(word);
  return base !== null && EN_COMMON_VERBS.has(base) ? base : null;
}

function prevWord(before: string): string {
  const m = /([A-Za-z]+)\s*$/.exec(before);
  return m ? m[1].toLowerCase() : "";
}

/** Whether a word before a label is probably a verb, making the label its
 * object, so a following -s word may be a plural noun ("gives Party A
 * points"). */
function enVerbLike(word: string): boolean {
  return /(?:s|ed)$/.test(word) || EN_NEUTRAL_NEXT.has(word) || EN_COMMON_VERBS.has(word);
}

/**
 * "you" for an English narrator plus how much of `after` it rewrote, or
 * null to keep the label. Only the word IMMEDIATELY after the label is
 * looked at; anything that does not settle the sentence shape (a comma,
 * an adverb, "alone", "himself") keeps the label, which reads better than
 * "you is" or "you pays".
 */
function enSelf(before: string, after: string): Rendered {
  const prev = prevWord(before);
  // An object of a preposition: nothing after it agrees with it.
  if (EN_PREPOSITIONS.has(prev)) return { text: "you", consumed: 0 };
  // Nothing after the label, or the sentence (or a quote) ends right there.
  if (/^\s*(?:[.!?…"”’)\]]|$)/u.test(after)) return { text: "you", consumed: 0 };
  const m = /^( )([A-Za-z]+?)(n['’]t)?(?![\p{L}\p{N}'’-])/u.exec(after);
  if (!m) return null;
  const [whole, space, word, neg = ""] = m;
  const lower = word.toLowerCase();
  // A second verb joined on must agree too ("was and is"): keep the label.
  const rest = after.slice(whole.length);
  const joined = /^\s+(?:and|or|but)\s+([A-Za-z]+?)(?:n['’]t)?(?![\p{L}'’])/u.exec(rest);
  if (joined && (EN_BE_HAVE[joined[1].toLowerCase()] || enKnownVerb(joined[1]))) return null;
  const be = EN_BE_HAVE[lower];
  if (be) return { text: `you${space}${be}${neg}`, consumed: whole.length };
  // "can't" splits as "ca" + "n't", "won't" as "wo" + "n't".
  if (neg) return EN_NEUTRAL_NEG.has(lower) ? { text: "you", consumed: 0 } : null;
  if (EN_NEUTRAL_NEXT.has(lower) || EN_OBJECT_NEXT.has(lower)) return { text: "you", consumed: 0 };
  if (/^[a-z]{3,}ed$/.test(lower) && !/eed$/.test(lower)) return { text: "you", consumed: 0 };
  const base = enKnownVerb(word);
  if (!base) return null;
  const trimmed = before.trimEnd();
  const subject = trimmed === "" || /[.!?;:,(—–"“]$/u.test(trimmed) || EN_SUBJECT_INTRO.has(prev);
  if (!subject && enVerbLike(prev)) return null;
  return { text: `you${space}${base}`, consumed: whole.length };
}

/**
 * A narrator's possessive ("Party A's"): "your" before the noun it owns,
 * "yours" when it ends the phrase ("were Party A's." -> "were yours."),
 * or null (keep the label) when the next word does not settle which.
 */
const EN_POSSESSIVE_ALONE_NEXT =
  /^(?:and|or|but|nor|too|either|instead|alone|is|are|was|were|has|have|had|will|would|can|could|should|might|must|may|seems?|seemed|stays?|stayed|remains?|remained)$/i;

function enSelfPossessive(after: string): Rendered {
  if (/^\s*(?:[.,;:!?…"”’)\]—–]|$)/u.test(after)) return { text: "yours", consumed: 0 };
  const next = /^ ([A-Za-z]+)(?![\p{L}\p{N}'’-])/u.exec(after);
  if (!next) return null;
  // A joined phrase or a verb right after it: the possessive stands alone
  // ("yours and Deniz's", "yours was better").
  if (EN_POSSESSIVE_ALONE_NEXT.test(next[1])) return { text: "yours", consumed: 0 };
  return { text: "your", consumed: 0 };
}

// Turkish narrator: "sen" forms, only where the result is surely grammatical.

const TR_SELF_CASE: Partial<Record<TrCase, string>> = {
  dat: "sana",
  acc: "seni",
  abl: "senden",
  loc: "sende",
  locki: "sendeki",
  ins: "seninle",
  genki: "seninki",
};

/** Postpositions after a bare narrator label: a pronoun takes the genitive
 * before them ("Taraf A için" -> "senin için"), and a few carry a possessive
 * that turns second person ("açısından" -> "açından"). */
const TR_SELF_POSTPOSITION: Record<string, string> = {
  için: "senin için",
  gibi: "senin gibi",
  kadar: "senin kadar",
  hakkında: "senin hakkında",
  ile: "seninle",
  tarafından: "senin tarafından",
  yüzünden: "senin yüzünden",
  açısından: "senin açından",
  sayesinde: "senin sayende",
  adına: "senin adına",
  yerine: "senin yerine",
  lehine: "senin lehine",
  aleyhine: "senin aleyhine",
};

const TR_ADVERBS =
  "daha|çok|biraz|kesinlikle|tamamen|kısmen|büyük ölçüde|genel olarak|yine de|bu konuda|burada|bu kez|bu sefer|açıkça|haklı olarak";

/** Words ending like a possessive that are quantifiers or adverbs, not a
 * possessed noun ("Taraf A'nın çoğu iddiası"). */
const TR_NOT_POSSESSED = /^(?:çoğu|birçoğu|aşağı|elmas)/u;

/**
 * The word after "Taraf A'nın", turned to agree with "senin", or null when
 * that cannot be done safely. Only two endings are unambiguous:
 * - "-ğI" gains "-n" ("olduğu" -> "olduğun", "istediği" -> "istediğin"):
 *   a final ğ only ever arises before a vowel suffix, so the -I is the
 *   possessive and the stem is never in doubt.
 * - a verbal noun "-mAsI" after a consonant turns "-n" ("gelmesi" ->
 *   "gelmen", "yapmasına" -> "yapmana", "gelmesiyle" -> "gelmenle").
 * Everything else is left alone, because the second-person form depends on
 * the stem: a vowel+s ending may be a vowel stem ("araba-sı" -> "araban")
 * or an s stem ("otobüs-ü" -> "otobüsün", "heves-i" -> "hevesin"); a
 * consonant + I ending may be an adjective ("haklı"), a pronoun ("bunu",
 * "buna", "başkasını") or a stem ending in -In ("düğün-ü" -> "düğünün");
 * and the word may not belong to the genitive at all ("sonunda").
 */
function trPossessedSecondPerson(word: string): string | null {
  const w = word.toLocaleLowerCase("tr");
  if (TR_NOT_POSSESSED.test(w)) return null;
  if (/ğ[ıiuü]$/u.test(w)) return word + "n";
  const m = /(?:[^aeıioöuü]|m[ae])m[ae](s[ıi])(n(?:[ae]|[ıi]|[dt][ae]n?|[ıi]n)|yl[ae])?$/u.exec(w);
  if (m) {
    const at = w.length - m[1].length - (m[2]?.length ?? 0);
    const tail = m[2] === undefined ? "n" : m[2].startsWith("y") ? "nl" + word.slice(-1) : word.slice(at + 2);
    return word.slice(0, at) + tail;
  }
  return null;
}

function trSelf(trCase: TrCase | "nom", after: string): { text: string; consumed: number } | null {
  if (trCase === "nom") {
    const post = /^\s+(\p{L}+)(?!\p{L})/u.exec(after);
    const phrase = post ? TR_SELF_POSTPOSITION[post[1].toLocaleLowerCase("tr")] : undefined;
    if (post && phrase) return { text: phrase, consumed: post[0].length };
    const right = new RegExp(
      `^\\s+((?:(?:${TR_ADVERBS})\\s+)*)(haklı|haksız)(y?dı)?(?=\\s*(?:[.!?,;:)…—–]|$))`,
      "u",
    ).exec(after);
    if (right) {
      const [whole, adverbs, adj, past] = right;
      const ending = past ? `${past}n` : "sın";
      return { text: `sen ${adverbs}${adj}${ending}`, consumed: whole.length };
    }
    return null;
  }
  if (trCase === "gen") {
    const next = /^(\s+)(\p{L}+)/u.exec(after);
    if (!next) return null;
    const turned = trPossessedSecondPerson(next[2]);
    if (turned === null) return null;
    return { text: `senin${next[1]}${turned}`, consumed: next[0].length };
  }
  const form = TR_SELF_CASE[trCase];
  if (!form) return null;
  // A following "da/de" or question particle agrees with the label ("Taraf A'da da");
  // make it agree with the pronoun instead ("sende de", "sana da").
  const clitic = /^(\s+)(da|de|mı|mi|mu|mü)(?![\p{L}\p{N}])/u.exec(after);
  if (!clitic) return { text: form, consumed: 0 };
  const back = /[aıou][^aeıioöuü]*$/u.test(form);
  const particle = clitic[2].startsWith("m") ? (back ? "mı" : "mi") : back ? "da" : "de";
  return { text: `${form}${clitic[1]}${particle}`, consumed: clitic[0].length };
}

type Rendered = { text: string; consumed: number } | null;

function renderEn(party: Party, suffix: string | undefined, apos: string, before: string, after: string): Rendered {
  let possessive = false;
  if (suffix !== undefined) {
    if (suffix === "s") possessive = true;
    else {
      const c = classifyTr(suffix);
      if (!c) return null;
      // A Turkish suffix left in English text: a genitive reads as "'s",
      // any other case is dropped (as the translation backstop does).
      possessive = c === "gen" || c === "genki";
    }
  }
  if (!party.self) {
    return { text: possessive ? `${party.name}${apos || "'"}s` : party.name, consumed: 0 };
  }
  const r = possessive ? enSelfPossessive(after) : enSelf(before, after);
  if (!r) return null;
  return atSentenceStart(before) ? { ...r, text: capitalize(r.text, "en") } : r;
}

function renderTr(party: Party, suffix: string | undefined, apos: string, before: string, after: string): Rendered {
  const trCase: TrCase | "nom" | null =
    suffix === undefined ? "nom" : suffix === "s" ? "gen" : classifyTr(suffix);
  if (!trCase) return null;
  if (!party.self) {
    if (trCase === "nom") return { text: party.name, consumed: 0 };
    const tail = trSuffix(party.name, trCase);
    return tail === null ? null : { text: `${party.name}${apos || "'"}${tail}`, consumed: 0 };
  }
  const r = trSelf(trCase, after);
  if (!r) return null;
  return atSentenceStart(before) ? { ...r, text: capitalize(r.text, "tr") } : r;
}

/**
 * Put real names back into verdict text written with labels. `textLang` is
 * the language the text is written in. Names get the suffix the sentence
 * needs ("Taraf B'nin" -> "Deniz'in", "Ayşe'nin"; "Party B's" -> "Deniz's").
 * A narrator becomes "you"/"sen" only where that stays grammatical; any
 * label that cannot be rendered with confidence is left as written, which
 * reads better than broken grammar.
 */
export function restoreNames(text: string, parties: Parties, textLang: Lang): string {
  if (!text || parties.size === 0) return text;
  const re = new RegExp(LABEL_IN_TEXT.source, LABEL_IN_TEXT.flags);
  let out = "";
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [whole, word, letter, apos = "", suffix] = m;
    const isParty = word === "Party" || word === "Taraf";
    if (isParty !== (letter === "A" || letter === "B")) continue;
    const party = parties.get(letter);
    if (!party) continue;
    const before = text.slice(0, m.index);
    const after = text.slice(m.index + whole.length);
    const r =
      textLang === "tr"
        ? renderTr(party, suffix, apos, before, after)
        : renderEn(party, suffix, apos, before, after);
    if (!r) continue;
    out += text.slice(pos, m.index) + r.text;
    pos = m.index + whole.length + r.consumed;
    re.lastIndex = pos;
  }
  return out + text.slice(pos);
}

/**
 * The verdict with real names in its free text, for the author's own view
 * only. Display-only: the stored row and share pages stay anonymized.
 * `selfLang` is the language the argument was judged in (narrator
 * detection); the grammar follows the language the text is written in,
 * which differs once the verdict has been translated. Returns the same
 * object when there is nothing to restore. Two-sided fields and an appeal
 * summary are restored the same way when present.
 */
export function personalizeResult(
  result: VerdictResult,
  nameMap: NameMapping[] | undefined,
  selfLang: Lang,
  selfParty: SelfParty = "A",
  opts: NameOptions = {},
): VerdictResult {
  const parties = resolveParties(nameMap, selfLang, selfParty, opts);
  if (parties.size === 0) return result;
  const lang = verdictLang(result);
  const r = (s: string) => restoreNames(s, parties, lang);
  const map = result.argument_map;
  return {
    ...result,
    headline: r(result.headline),
    ...(result.why !== undefined ? { why: r(result.why) } : {}),
    crux: r(result.crux),
    losing_side_best_point: r(result.losing_side_best_point),
    split_points: result.split_points?.map((p) => ({ ...p, point: r(p.point) })) ?? null,
    conditional: result.conditional?.map((c) => ({ ...c, if_value: r(c.if_value), then: r(c.then) })) ?? null,
    argument_map: {
      ...map,
      side_a: map.side_a.map((c) => ({ ...c, claim: r(c.claim) })),
      side_b: map.side_b.map((c) => ({ ...c, claim: r(c.claim) })),
      bedrock_a: r(map.bedrock_a),
      bedrock_b: r(map.bedrock_b),
    },
    facts_relied_on: result.facts_relied_on.map(r),
    ...(result.lean ? { lean: { ...result.lean, reason: r(result.lean.reason) } } : {}),
    ...(result.crux_trial
      ? {
          crux_trial: {
            ...result.crux_trial,
            attack: r(result.crux_trial.attack),
            reasoning: r(result.crux_trial.reasoning),
          },
        }
      : {}),
    ...(result.fact_check
      ? {
          fact_check: {
            ...result.fact_check,
            claims: result.fact_check.claims.map((c) => ({ ...c, claim: r(c.claim), summary: r(c.summary) })),
          },
        }
      : {}),
    ...(result.agreed_facts ? { agreed_facts: result.agreed_facts.map(r) } : {}),
    ...(result.disputed_facts
      ? {
          disputed_facts: result.disputed_facts.map((d) => ({
            ...d,
            fact: r(d.fact),
            party_a: r(d.party_a),
            party_b: r(d.party_b),
          })),
        }
      : {}),
    ...(result.would_change ? { would_change: result.would_change.map(r) } : {}),
    ...(result.appeal ? { appeal: { ...result.appeal, summary: r(result.appeal.summary) } } : {}),
  };
}

// --- Labels in anonymized text, by the text's language ----------------------------

/** A label in running text, either language, suffix kept. */
const ANY_LABEL = /(?<![\p{L}\p{N}])(Party|Taraf|Person|Kişi) ([A-Z])(?![\p{L}\p{N}])/gu;

/** Common Turkish function words for telling a text's language when it has
 * no Turkish-only letter. */
const TR_WORDS = /(?<![\p{L}])(?:ve|bir|bu|ama|için|çok|değil|gibi|ile|diye|sonra|çünkü|hiç|daha|kadar|ediyor|dedi|oldu)(?![\p{L}])/giu;
const EN_WORDS = /(?<![\p{L}])(?:the|and|is|was|that|with|for|said|says|this|they|because|would|have)(?![\p{L}])/giu;

/** The language an anonymized text is written in: the Turkish labels, else
 * whichever language's function words are more frequent; a Turkish-only
 * letter (ğ, ı, İ, ş) decides only a tie, so an English sentence that keeps
 * a Turkish place name ("moved to Beşiktaş") stays English. */
export function textLang(text: string): Lang {
  if (/(?<![\p{L}])(?:Taraf [AB]|Kişi [C-Z])(?![\p{L}])/u.test(text)) return "tr";
  const tr = text.match(TR_WORDS)?.length ?? 0;
  const en = text.match(EN_WORDS)?.length ?? 0;
  if (tr !== en) return tr > en ? "tr" : "en";
  return /[ğıİşĞŞ]/u.test(text) ? "tr" : "en";
}

/**
 * The anonymized labels in the words of `lang`: "Party A" <-> "Taraf A",
 * "Person C" <-> "Kişi C". A suffix after the apostrophe is kept as written
 * (it already agrees with the letter, which reads the same in both). Stored
 * and judged text keeps the English labels; this is for display only, with
 * `lang` the language of the text itself (textLang), not of the interface.
 * Pure.
 */
export function localizeLabels(text: string, lang: Lang): string {
  if (!text) return text;
  return text.replace(ANY_LABEL, (whole: string, word: string, letter: string) => {
    const party = word === "Party" || word === "Taraf";
    if (party !== (letter === "A" || letter === "B")) return whole;
    if (lang === "tr") return `${party ? "Taraf" : "Kişi"} ${letter}`;
    return `${party ? "Party" : "Person"} ${letter}`;
  });
}

/** localizeLabels by the text's own language. */
export function localizeLabelsAuto(text: string): string {
  return localizeLabels(text, textLang(text));
}

// --- One way of naming the viewer per verdict -----------------------------------------

/** Every free-text field personalizeResult restores. */
function resultTexts(result: VerdictResult): string[] {
  const map = result.argument_map;
  return [
    result.headline,
    result.why,
    result.crux,
    result.losing_side_best_point,
    ...(result.split_points ?? []).map((p) => p.point),
    ...(result.conditional ?? []).flatMap((c) => [c.if_value, c.then]),
    ...map.side_a.map((c) => c.claim),
    ...map.side_b.map((c) => c.claim),
    map.bedrock_a,
    map.bedrock_b,
    ...result.facts_relied_on,
    ...(result.lean ? [result.lean.reason] : []),
    ...(result.crux_trial ? [result.crux_trial.attack, result.crux_trial.reasoning] : []),
    ...(result.fact_check?.claims ?? []).flatMap((c) => [c.claim, c.summary]),
    ...(result.agreed_facts ?? []),
    ...(result.disputed_facts ?? []).flatMap((d) => [d.fact, d.party_a, d.party_b]),
    ...(result.would_change ?? []),
    ...(result.appeal ? [result.appeal.summary] : []),
  ].filter((s): s is string => typeof s === "string" && s.length > 0);
}

/**
 * The name map to display a verdict with, so the viewer is named ONE way
 * across the whole card. Restoration is conservative: "Party A" becomes
 * "you"/"sen" only where the grammar is surely right, and stays a label
 * elsewhere ("Party A now wants 120"). When any of the viewer's labels in
 * the verdict would stay, the viewer's entries are dropped, so every
 * mention keeps the label and the header says "Party A (you)" instead of
 * mixing "You" and "Party A" for the same person. Other people's names are
 * unaffected. Returns the same map when nothing changes. Pure.
 */
export function consistentSelfMap(
  result: VerdictResult,
  nameMap: NameMapping[] | undefined,
  selfLang: Lang,
  selfParty: SelfParty = "A",
  opts: NameOptions = {},
): { nameMap: NameMapping[] | undefined; selfDropped: boolean } {
  if (!nameMap?.length || opts.noSelf) return { nameMap, selfDropped: false };
  const parties = resolveParties(nameMap, selfLang, selfParty);
  const self = parties.get(selfParty);
  if (!self?.self) return { nameMap, selfDropped: false };
  const only = new Map([[selfParty, self]]);
  const lang = verdictLang(result);
  const label = new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:Party|Taraf) ${selfParty}(?:['’]\p{Ll}+)?(?![\p{L}\p{N}])`,
    "u",
  );
  const keepsLabel = resultTexts(result).some((s) => label.test(restoreNames(s, only, lang)));
  if (!keepsLabel) return { nameMap, selfDropped: false };
  return {
    nameMap: nameMap.filter((m) => labelLetter(m.replacement) !== selfParty),
    selfDropped: true,
  };
}
