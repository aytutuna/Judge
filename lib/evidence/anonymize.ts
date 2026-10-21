/**
 * Anonymizes one submission (an account or appeal text plus the raw
 * transcripts of its evidence) in a single model call, so text and
 * screenshots share one name map. For later submissions of a case it gets
 * the earlier anonymized material (to recognize people by role) and the
 * case's name fingerprints (to give an exactly matching name the same label
 * deterministically). Fails closed with AnonymizeError: raw text never
 * comes back.
 */

import {
  accountQualityIssues,
  AnonymizeError,
  findNameLeak,
  firstPersonPresent,
  heldCandidates,
  isNotName,
  isTurkishText,
  nameRules,
  normalizeNameMap,
  onlyPlaceUses,
  qualityLines,
  qualityReason,
  retryLines,
  substituteNames,
  trAccountRules,
  unlistedCandidates,
  type NameRule,
  type QualityIssue,
  type RetryHint,
} from "@/lib/anonymize";
import { claudeJson, hasApiKey, LITE_MODEL } from "@/lib/claude";
import { bareName, canonicalLabel, EN_SELF, TR_SELF } from "@/lib/names";
import type { NameMapping } from "@/lib/types";
import { SELF_SPEAKER } from "./render";
import type { AnonymizedSubmission, KnownPerson, SubmissionInput, VerifiedEvidence } from "./types";

const SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, transcript: { type: "string" } },
        required: ["index", "transcript"],
      },
    },
    replacements: {
      type: "array",
      items: {
        type: "object",
        properties: { original: { type: "string" }, replacement: { type: "string" } },
        required: ["original", "replacement"],
      },
    },
  },
  required: ["text", "evidence", "replacements"],
} as const;

type ModelOutput = {
  text: string;
  evidence: { index: number; transcript: string }[];
  replacements: { original: string; replacement: string }[];
};

type Narrator = SubmissionInput["narrator"];

const otherParty = (narrator: Narrator): Narrator => (narrator === "Party A" ? "Party B" : "Party A");

/** The system prompt for one submission. Exported for tests. */
export function submissionSystem(
  input: Pick<SubmissionInput, "narrator" | "twoSided" | "roster"> & Partial<Pick<SubmissionInput, "text" | "lang">>,
): string {
  const n = input.narrator;
  const o = otherParty(n);
  const opponent = input.twoSided
    ? `- The account is about a disagreement with one main person. That person is ALWAYS "${o}", whether the narrator names them, calls them a friend, roommate, sibling or anything else; "${o}" also wrote their own account separately. Use "Person C" and up only for people other than the two parties.`
    : `- The person the narrator argues with is "${o}".`;
  const turkish = input.lang === "tr" || (input.text !== undefined && isTurkishText(input.text));
  const roster = input.roster
    ? `- EARLIER CASE MATERIAL is shown first, already anonymized. It is for reference only: never output it. When the submission mentions someone who appears there (by name, role or relationship, e.g. "my sister" who is Person C there), use the same label. A new person gets the next free label; labels already in use: ${input.roster.labelsInUse.join(", ") || "none"}.`
    : "";
  return `You anonymize one submission in a dispute between two parties: an ACCOUNT written by one party (the narrator), plus machine transcripts of screenshots or photos the narrator attached as EVIDENCE.

Labels:
- The narrator is ALWAYS "${n}". First person marks the narrator in any language. English: "I", "me", "my", "myself". Turkish: "ben", "bence", "benim", "bana", "beni", "bende", "benden", "benimle", and also first-person endings with no pronoun at all ("düşünüyorum", "söyledim", "haklıyım", "arkadaşım").
${opponent}
- Other named people become "Person C", "Person D", and so on. The same person always gets the same label, in the account and in every transcript.
${roster ? `${roster}\n` : ""}
In the ACCOUNT:
- Rewrite the narrator's first-person sentences about themselves in the third person, adjusting only the pronoun and verb ending ("I think" -> "${n} thinks", "Ben ise düşünüyorum" -> "${n} ise düşünüyor").
- Replace real names, usernames and nicknames everywhere with the labels, keeping grammar natural. In Turkish text keep the case suffix on the label after an apostrophe ("Deniz'in" -> "${o}'nin").

In each EVIDENCE transcript:
- Keep the structure exactly: the first line in square brackets, one line per message as "time speaker: message", then the "Other text:" and "Description:" lines if present.
- The speaker "${SELF_SPEAKER}" is the narrator: write "${n}" instead.
- Replace names in the bracketed title, in speaker labels and inside messages with the labels. A chat title or speaker is the person behind that name: use the label that person has in the account.
- Do NOT rewrite messages into the third person: they are quoted words. Keep every message verbatim except for names.

Everywhere:
- Replace phone numbers, e-mail addresses, social media handles and account or ID numbers with a generic term in square brackets ("[phone number]", "[e-mail]", "[handle]", "[account number]").
- Replace specific company, school or place names that could identify someone with generic terms ("the company", "their school", "the city").
- Change NOTHING else: keep every claim, detail, number, time and the tone exactly as written, in the same language as the input.
- Return every transcript with its index.
- List every replacement you made, one entry per person, not one per inflected form. "original" is the bare name exactly as spelled, WITHOUT any case suffix, possessive ending or apostrophe ("Deniz", never "Deniz'in"; "Mark", never "Mark's"); "replacement" is the bare label ("${o}", never "${o}'nin").
- ALWAYS include {"original": "I", "replacement": "${n}"}.

The labels are always exactly "Party A", "Party B", "Person C"… regardless of language.${turkish ? `

${trAccountRules(n, o)}` : ""}`;
}

/** The user turn: earlier material (reference only), the account, the transcripts. */
export function submissionUser(input: Pick<SubmissionInput, "text" | "evidence" | "roster">): string {
  const parts: string[] = [];
  if (input.roster?.context.trim()) {
    parts.push(`<earlier_case_material>\n${input.roster.context.trim()}\n</earlier_case_material>`);
  }
  parts.push(`<account>\n${input.text}\n</account>`);
  input.evidence.forEach((e, i) => parts.push(`<evidence index="${i}">\n${e.transcript}\n</evidence>`));
  return parts.join("\n\n");
}

const LABEL_IN_TEXT = /(?<![\p{L}])(Party [AB]|Person [C-Z])(?![\p{L}\p{N}])/gu;
const isParty = (label: string) => label === "Party A" || label === "Party B";
const isCaseLabel = (label: string) => /^(Party [AB]|Person [C-Z])$/.test(label);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "21:02 ME: ..." -> "21:02 Party A: ..." for any line the model left alone. */
export function replaceSelfSpeaker(transcript: string, narrator: Narrator): string {
  return transcript
    .split("\n")
    .map((line) => {
      const m = /^(.{0,25}?)ME: /u.exec(line);
      if (!m || m[1].includes(": ") || (m[1] !== "" && !m[1].endsWith(" "))) return line;
      return `${m[1]}${narrator}: ${line.slice(m[0].length)}`;
    })
    .join("\n");
}

/** Applies a label -> label map in one pass (so swaps work). */
export function relabelText(text: string, relabel: ReadonlyMap<string, string>): string {
  if (relabel.size === 0) return text;
  return text.replace(LABEL_IN_TEXT, (label: string) => relabel.get(label) ?? label);
}

/**
 * Model labels -> case labels from the fingerprints. For each named person
 * whose key is already known with another label: a model "Person X" becomes
 * the known label (swapping with whoever holds it in this submission, or
 * merging into a known party); a model party label never changes (roles are
 * structural). The full-name key wins over the first-word key. Pure.
 */
export function reconcileLabels(
  entries: readonly NameMapping[],
  known: readonly KnownPerson[],
  keysFor: (name: string) => string[],
): Map<string, string> {
  const knownByKey = new Map(known.map((k) => [k.key, k.label]));
  const modelLabels = new Set(entries.map((e) => e.replacement));
  const relabel = new Map<string, string>();
  const targets = new Set<string>();
  for (const e of entries) {
    const from = e.replacement;
    if (isParty(from) || relabel.has(from) || !isCaseLabel(from)) continue;
    let to: string | undefined;
    for (const key of keysFor(e.original)) {
      to = knownByKey.get(key);
      if (to) break;
    }
    if (!to || to === from || !isCaseLabel(to)) continue;
    if (isParty(to)) {
      relabel.set(from, to);
      continue;
    }
    if (targets.has(to)) continue;
    relabel.set(from, to);
    targets.add(to);
    if (modelLabels.has(to) && !relabel.has(to)) {
      relabel.set(to, from);
      targets.add(from);
    }
  }
  return relabel;
}

/** Whether `text` holds the original as a whole, case-sensitive word. */
function containsWord(text: string, word: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, "u").test(text);
}

/** Whether `index` is past the start of a sentence (a capitalized word there
 * is more likely a name than a sentence opener). */
function midSentence(text: string, index: number): boolean {
  const before = text.slice(0, index).trimEnd();
  return before !== "" && !/[.!?…:;"“”‘’'«»(\[\n—–-]$/u.test(before);
}

/**
 * The first leaked name, or null:
 * - an original of this submission (2+ letters, not the narrator or a label)
 *   still present as a whole, case-sensitive word anywhere in the output;
 * - a capitalized word in the output, in the middle of a sentence or with an
 *   apostrophe suffix, whose fingerprint is a known name of the case (a name
 *   from an earlier account that this call failed to replace).
 * Returns only a kind, never the name, so nothing personal reaches the logs.
 */
export function findLeak(
  nameMap: readonly NameMapping[],
  outputs: readonly string[],
  names?: SubmissionInput["names"],
): "listed" | "known" | null {
  for (const m of nameMap) {
    const original = m.original.trim();
    if (original === "I" || canonicalLabel(original)) continue;
    if ((original.match(/\p{L}/gu) ?? []).length < 2) continue;
    if (outputs.some((o) => containsWord(o, original))) return "listed";
  }
  if (names && names.known.length > 0) {
    const knownKeys = new Set(names.known.map((k) => k.key));
    const checked = new Map<string, boolean>();
    for (const out of outputs) {
      for (const m of out.matchAll(/(?<![\p{L}\p{N}])\p{Lu}\p{L}+(?:['’]\p{Ll}+)?/gu)) {
        const word = m[0].replace(/['’]\p{Ll}+$/u, "");
        if (word === "Party" || word === "Person") continue;
        if (!m[0].includes("'") && !m[0].includes("’") && !midSentence(out, m.index)) continue;
        let hit = checked.get(word);
        if (hit === undefined) {
          hit = names.keysFor(word).some((k) => knownKeys.has(k));
          checked.set(word, hit);
        }
        if (hit) return "known";
      }
    }
  }
  return null;
}

/**
 * Originals the model reported that must be gone from the output, beyond the
 * normalized map: an entry the model "replaced" with itself ("Elif" ->
 * "Elif") is dropped from the map but is still a name it saw. Narrator
 * pronouns and labels are skipped.
 */
export function rawOriginals(replacements: readonly { original: string; replacement: string }[]): string[] {
  const out: string[] = [];
  for (const r of replacements) {
    if (typeof r?.original !== "string") continue;
    const name = bareName(r.original);
    if (!name || canonicalLabel(name) || EN_SELF.test(name) || TR_SELF.has(name.toLocaleLowerCase("tr"))) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Labels in the output that nothing explains: not the two parties, not a
 * label of this submission's map, not a label already used in the case.
 * A sign of an inconsistent rewrite ("Person C" for someone mapped to
 * "Party B"), not of a leak. Pure.
 */
export function unexplainedLabels(
  outputs: readonly string[],
  nameMap: readonly NameMapping[],
  labelsInUse: readonly string[] = [],
): string[] {
  const allowed = new Set<string>(["Party A", "Party B", ...labelsInUse, ...nameMap.map((m) => m.replacement)]);
  const found = new Set<string>();
  for (const out of outputs) for (const m of out.matchAll(LABEL_IN_TEXT)) if (!allowed.has(m[1])) found.add(m[1]);
  return [...found];
}

type Ok = {
  ok: true;
  value: AnonymizedSubmission;
  /** Capitalized words of the account survived unlisted, or an echo of a
   * first-person account: a name may have been missed. */
  suspicious: string | null;
  /** Labels nothing explains (inconsistent, not a leak). */
  warning: string | null;
  issues: QualityIssue[];
};
type Failed = { ok: false; retry: boolean; error: string; leak: boolean };
type Attempt = (Ok | Failed) & {
  /** The person rules this attempt's own list produced (checked on the retry). */
  rules: NameRule[];
  hint: RetryHint;
};

/** How a retry's prompt is made firmer: the names paragraph after a leak or
 * flagged words, the quality lines after quality issues. */
type RetryPrompt = { names: RetryHint | null; issues: QualityIssue[] };

/** Medium effort: at low effort the model was seen leaving a name in place
 * and labelling one person two ways in a longer account with transcripts;
 * medium was clean in the same test at ~2k more output tokens. */
const ANONYMIZE_EFFORT = "medium" as const;
/** Per attempt, and for both attempts together (the retry gets what is left,
 * and only runs with at least RETRY_MIN_MS left). With fact-check 40 s and
 * the judges 120 s this ends by 280 s; the judging run counts this time
 * (startedAt is the request's start) and skips a refused seat's rerun when
 * it would not fit, so the request stays inside its 300 s budget. */
const ATTEMPT_TIMEOUT_MS = 75_000;
const TOTAL_BUDGET_MS = 120_000;
const RETRY_MIN_MS = 30_000;

const lowerTr = (s: string) => s.toLocaleLowerCase("tr");

/** Whether the model listed an original as itself ("Elif" -> "Elif") or
 * with an empty replacement. */
function isSelfReplacement(r: { original: string; replacement: string }): boolean {
  const target = r.replacement.trim();
  if (canonicalLabel(target)) return false;
  return !target || lowerTr(bareName(target)) === lowerTr(bareName(r.original));
}

/** A self-replaced original that is not a person in this text: a calendar,
 * brand or family word (isNotName), or a word the input only uses as a
 * place ("moved to Berlin", "İstanbul'da"). Kept as written and passed on as
 * a flagged word (a retry candidate), as lib/anonymize.ts does, instead of
 * being relabelled or failing the leak check. Pure. */
export function selfKeptWord(name: string, input: string | undefined): boolean {
  return isNotName(name) || (input !== undefined && onlyPlaceUses(input, name));
}

/**
 * The model's list with every self-replaced person ("Elif" -> "Elif", or an
 * empty replacement) given the next free "Person X" label, so code can take
 * the name out instead of failing on it. Only name-like originals: a
 * description ("my sister"), a narrator word, and a word that is not a
 * person here (selfKeptWord, judged on `input`) stay as listed. `taken`
 * holds every label the case and this answer already use; the same name
 * always gets the same new label. Pure.
 */
export function labelSelfReplaced(
  replacements: readonly { original: string; replacement: string }[],
  taken: ReadonlySet<string>,
  turkish: boolean,
  input?: string,
): { original: string; replacement: string }[] {
  const used = new Set(taken);
  const given = new Map<string, string>();
  const next = (): string | null => {
    for (let c = 67; c <= 90; c++) {
      const label = `Person ${String.fromCharCode(c)}`;
      if (!used.has(label)) {
        used.add(label);
        return label;
      }
    }
    return null;
  };
  return replacements.map((r) => {
    if (!isSelfReplacement(r)) return r;
    const name = bareName(r.original);
    if (rawOriginals([r]).length === 0 || !/^\p{Lu}/u.test(name)) return r;
    if (selfKeptWord(name, input)) return r;
    if (nameRules([{ original: name, replacement: "Person C" }], turkish).length === 0) return r;
    const key = lowerTr(name);
    const label = given.get(key) ?? next();
    if (!label) return r;
    given.set(key, label);
    return { original: r.original, replacement: label };
  });
}

/**
 * Capitalized words in the outputs whose fingerprint is a known name of the
 * case, where findLeak would count them (mid-sentence or with an apostrophe
 * suffix), each with that person's case label: names from an earlier account
 * that this call left in place. Pure.
 */
export function knownNameHits(
  outputs: readonly string[],
  names: NonNullable<SubmissionInput["names"]>,
): { original: string; replacement: string }[] {
  const byKey = new Map(names.known.map((k) => [k.key, k.label]));
  const checked = new Set<string>();
  const hits: { original: string; replacement: string }[] = [];
  for (const out of outputs) {
    for (const m of out.matchAll(/(?<![\p{L}\p{N}])\p{Lu}\p{L}+(?:['’]\p{Ll}+)?/gu)) {
      const word = m[0].replace(/['’]\p{Ll}+$/u, "");
      if (checked.has(word) || ["Party", "Person", "Taraf", "Kişi"].includes(word)) continue;
      if (!m[0].includes("'") && !m[0].includes("’") && !midSentence(out, m.index)) continue;
      checked.add(word);
      for (const key of names.keysFor(word)) {
        const label = byKey.get(key);
        if (label && isCaseLabel(label)) {
          hits.push({ original: word, replacement: label });
          break;
        }
      }
    }
  }
  return hits;
}

const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/**
 * One model call, then the code-side guard shared with lib/anonymize.ts:
 * 1. shape checks; the narrator's "ME" speaker replaced;
 * 2. self-replaced people get a free Person label (labelSelfReplaced); a
 *    self-replaced word that is not a person here (selfKeptWord) stays and
 *    is only a flagged word;
 * 3. every listed name is substituted in code in the account and every
 *    transcript (possessives, Turkish suffixes, glued Turkish cases);
 * 4. labels reconciled with the case fingerprints;
 * 5. names from earlier accounts left in place are replaced by their known
 *    label (knownNameHits);
 * 6. leak checks: a listed name in a name use (findNameLeak, also against the
 *    names the first attempt listed), a known name, a listed name no rule
 *    covers; then an echo of the input, and on the retry a flagged word left
 *    as a person (heldCandidates);
 * 7. suspicious (flagged words or an echo), inconsistent labels and quality
 *    issues of the account (accountQualityIssues) are returned for the caller
 *    to decide on a retry.
 */
async function attempt(
  input: SubmissionInput,
  timeoutMs: number,
  retry: RetryPrompt | null,
  prior: readonly NameRule[],
): Promise<Attempt> {
  const narrator = input.narrator;
  const opponent = otherParty(narrator);
  const extra = retry
    ? [...(retry.names ? retryLines(retry.names) : []), ...qualityLines(retry.issues, narrator, opponent)]
    : [];
  const system = submissionSystem(input);
  const res = await claudeJson<ModelOutput>({
    system: extra.length ? `${system}\n\n${extra.join("\n")}` : system,
    user: submissionUser(input),
    schema: SCHEMA,
    effort: ANONYMIZE_EFFORT,
    model: LITE_MODEL,
    timeoutMs,
  });
  const none = { rules: [], hint: retry?.names ?? { names: [], candidates: [] }, leak: false };
  if (!res.ok) return { ok: false, retry: false, error: res.blocked ? `blocked (${res.reason})` : res.error, ...none };

  const data = res.data;
  if (typeof data?.text !== "string" || !data.text.trim() || !Array.isArray(data.replacements) || !Array.isArray(data.evidence)) {
    return { ok: false, retry: true, error: "anonymizer returned malformed output", ...none };
  }
  const byIndex = new Map<number, string>();
  for (const e of data.evidence) {
    if (typeof e?.index === "number" && typeof e.transcript === "string" && e.transcript.trim()) {
      byIndex.set(e.index, e.transcript);
    }
  }
  if (input.evidence.some((_, i) => !byIndex.has(i))) {
    return { ok: false, retry: true, error: "anonymizer dropped an evidence transcript", ...none };
  }

  const turkish = isTurkishText(input.text);
  const rawCombined = [input.text, ...input.evidence.map((e) => e.transcript)].join("\n\n");
  let text = data.text;
  let transcripts = input.evidence.map((_, i) => replaceSelfSpeaker(byIndex.get(i) ?? "", narrator));
  const listed = data.replacements.filter(
    (r) => typeof r?.original === "string" && typeof r?.replacement === "string",
  );

  const taken = new Set<string>(["Party A", "Party B", ...(input.roster?.labelsInUse ?? [])]);
  for (const k of input.names?.known ?? []) taken.add(k.label);
  for (const r of listed) {
    const label = canonicalLabel(r.replacement);
    if (label) taken.add(label);
  }
  for (const out of [text, ...transcripts]) for (const m of out.matchAll(LABEL_IN_TEXT)) taken.add(m[1]);
  const replacements = labelSelfReplaced(listed, taken, turkish, rawCombined);
  // Self-listed words that are not people here: flagged words, not leaks.
  const keptWords = new Set(
    listed
      .filter((r) => isSelfReplacement(r) && selfKeptWord(bareName(r.original), rawCombined))
      .map((r) => lowerTr(bareName(r.original))),
  );

  const normalized = normalizeNameMap(replacements, rawCombined, [text, ...transcripts].join("\n\n"), { narrator });
  const rules = nameRules([...replacements, ...normalized], turkish, rawCombined);
  text = substituteNames(text, rules, turkish);
  transcripts = transcripts.map((t) => substituteNames(t, rules, turkish));
  // The narrator is structural: always exactly one { I -> narrator } entry, first.
  let entries = normalized.filter((m) => m.original !== "I");

  if (input.names) {
    const relabel = reconcileLabels(entries, input.names.known, input.names.keysFor);
    if (relabel.size > 0) {
      text = relabelText(text, relabel);
      transcripts = transcripts.map((t) => relabelText(t, relabel));
      entries = entries.map((m) => ({ ...m, replacement: relabel.get(m.replacement) ?? m.replacement }));
    }
    const hits = knownNameHits([text, ...transcripts], input.names);
    if (hits.length > 0) {
      const repair = nameRules(hits, turkish, rawCombined);
      text = substituteNames(text, repair, turkish);
      transcripts = transcripts.map((t) => substituteNames(t, repair, turkish));
      entries = [...entries, ...hits];
    }
  }
  const seen = new Set<string>();
  entries = entries.filter((m) => {
    const key = `${m.original}\u0000${m.replacement}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const nameMap: NameMapping[] = [{ original: "I", replacement: narrator }, ...entries];

  const outputs = [text, ...transcripts];
  const people = rules.filter((r) => r.person);
  const hint: RetryHint = {
    names: [...new Set([...prior, ...people].map((r) => r.name))],
    candidates: unlistedCandidates(input.text, text, rules, listed),
  };
  const base = { rules: people, hint };
  // Names a rule covers are checked by findNameLeak, which knows ordinary
  // words ("Can you") from names; findLeak covers the rest, name-like only.
  const covered = new Set(rules.map((r) => lowerTr(r.name)));
  const uncovered = (name: string) =>
    !covered.has(lowerTr(name)) && nameRules([{ original: name, replacement: "Person C" }], turkish).length > 0;
  const checkRules = [...people, ...prior];
  const leak = outputs.some((o) => findNameLeak(o, checkRules, turkish))
    ? "listed"
    : (findLeak(
        nameMap.filter((m) => uncovered(m.original)),
        outputs,
        input.names,
      ) ??
      (findLeak(
        rawOriginals(listed)
          .filter((name) => uncovered(name) && !keptWords.has(lowerTr(name)))
          .map((original) => ({ original, replacement: "" })),
        outputs,
      )
        ? "listed"
        : null));
  if (leak) return { ok: false, retry: true, error: `a ${leak} name survived anonymization`, leak: true, ...base };

  const firstPerson = firstPersonPresent(input.text);
  if (sameText(text, input.text) && (people.some((r) => r.label) || hint.candidates.length > 0 || firstPerson)) {
    // Returned as written: with names listed, possible names in it, or a
    // narrator left in the first person. Never passed on.
    return { ok: false, retry: retry === null, error: "output identical to the input", leak: true, ...base };
  }
  if (retry && heldCandidates(input.text, text, hint.candidates).length > 0) {
    return { ok: false, retry: true, error: "a flagged name survived unlisted", leak: true, ...base };
  }

  const odd = unexplainedLabels(outputs, nameMap, input.roster?.labelsInUse);
  const issues = accountQualityIssues(input.text, text, {
    narrator,
    opponentRequired: input.opponentRequired === true,
  });

  const known: KnownPerson[] = [];
  if (input.names) {
    const knownKeys = new Set(input.names.known.map((k) => k.key));
    for (const m of entries) {
      if (!isCaseLabel(m.replacement)) continue;
      for (const key of input.names.keysFor(m.original)) {
        if (knownKeys.has(key)) continue;
        knownKeys.add(key);
        known.push({ label: m.replacement, key });
      }
    }
  }

  const evidence: VerifiedEvidence[] = input.evidence.map((e, i) => ({ kind: e.kind, transcript: transcripts[i] }));
  return {
    ok: true,
    value: { text, evidence, nameMap, people: known },
    suspicious: hint.candidates.length > 0 ? "unlisted capitalized words survived" : null,
    warning: odd.length ? `unexplained labels ${odd.join(",")}` : null,
    issues,
    ...base,
  };
}

/** How far an accepted attempt is from clean: quality issues plus
 * inconsistent labels. */
const flaws = (a: Ok) => a.issues.length + (a.warning ? 1 : 0);

/**
 * One model call, plus at most one retry, as lib/anonymize.ts does it:
 * - a leak (a name survived the code-side repair), malformed output or an
 *   echo retries; a leak on the retry throws AnonymizeError (callers must
 *   then neither judge nor store anything, and must refund);
 * - flagged words (unlisted capitalized words that survived) retry with
 *   those words named; the retry must then not hold one of them as a person;
 *   if the retry leaks, the first attempt is kept only when none of the
 *   retry's names is in it and none of its flagged words reads as a person;
 * - inconsistent labels or quality issues alone retry once naming the
 *   issues; the first attempt is safe either way, and the retry replaces it
 *   only with fewer flaws.
 * Logs carry reasons and issue codes only, never names.
 */
export async function anonymizeSubmission(input: SubmissionInput): Promise<AnonymizedSubmission> {
  if (!hasApiKey()) throw new AnonymizeError("ANTHROPIC_API_KEY not set");
  const started = Date.now();
  const turkish = isTurkishText(input.text);
  let first: Extract<Attempt, { ok: true }> | null = null;
  let retry: RetryPrompt | null = null;
  let prior: NameRule[] = [];
  let last = "";
  const accept = (a: Ok) => {
    if (a.issues.length) console.warn(`[evidence] anonymize quality: ${a.issues.join(",")}`);
    return a.value;
  };
  for (let i = 0; i < 2; i++) {
    const left = TOTAL_BUDGET_MS - (Date.now() - started);
    if (i > 0 && left < RETRY_MIN_MS) break;
    const res = await attempt(input, Math.min(ATTEMPT_TIMEOUT_MS, left), retry, prior);
    if (res.ok) {
      if (i > 0) return accept(first && !first.suspicious && flaws(first) <= flaws(res) ? first : res);
      if (!res.suspicious && !res.warning && res.issues.length === 0) return res.value;
      first = res;
      retry = { names: res.suspicious ? res.hint : null, issues: res.issues };
      last = res.suspicious ?? res.warning ?? qualityReason(res.issues);
    } else {
      last = res.error;
      if (first && !first.suspicious) return accept(first);
      if (
        first &&
        res.retry &&
        res.rules.length > 0 &&
        ![first.value.text, ...first.value.evidence.map((e) => e.transcript)].some((o) =>
          findNameLeak(o, res.rules, turkish),
        ) &&
        heldCandidates(input.text, first.value.text, first.hint.candidates).length === 0
      ) {
        return accept(first);
      }
      if (!res.retry) break;
      retry = { names: res.leak ? res.hint : null, issues: [] };
    }
    prior = [...prior, ...res.rules];
    console.warn(`[evidence] anonymize retry: ${last}`);
  }
  if (first && !first.suspicious) return accept(first);
  throw new AnonymizeError(last);
}
