/**
 * Anonymizes one submission (an account or appeal text plus the raw
 * transcripts of its evidence) in a single model call, so text and
 * screenshots share one name map. For later submissions of a case it gets
 * the earlier anonymized material (to recognize people by role) and the
 * case's name fingerprints (to give an exactly matching name the same label
 * deterministically). Fails closed with AnonymizeError: raw text never
 * comes back.
 */

import { AnonymizeError, normalizeNameMap } from "@/lib/anonymize";
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
export function submissionSystem(input: Pick<SubmissionInput, "narrator" | "twoSided" | "roster">): string {
  const n = input.narrator;
  const o = otherParty(n);
  const opponent = input.twoSided
    ? `- The person the narrator argues with is ALWAYS "${o}". In this case "${o}" also wrote their own account separately.`
    : `- The person the narrator argues with is "${o}".`;
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

The labels are always exactly "Party A", "Party B", "Person C"… regardless of language.`;
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

type Attempt =
  | { ok: true; value: AnonymizedSubmission; warning?: string }
  | { ok: false; retry: boolean; error: string };

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

async function attempt(input: SubmissionInput, timeoutMs: number): Promise<Attempt> {
  const res = await claudeJson<ModelOutput>({
    system: submissionSystem(input),
    user: submissionUser(input),
    schema: SCHEMA,
    effort: ANONYMIZE_EFFORT,
    model: LITE_MODEL,
    timeoutMs,
  });
  if (!res.ok) return { ok: false, retry: false, error: res.blocked ? `blocked (${res.reason})` : res.error };

  const data = res.data;
  if (typeof data?.text !== "string" || !data.text.trim() || !Array.isArray(data.replacements) || !Array.isArray(data.evidence)) {
    return { ok: false, retry: true, error: "anonymizer returned malformed output" };
  }
  const byIndex = new Map<number, string>();
  for (const e of data.evidence) {
    if (typeof e?.index === "number" && typeof e.transcript === "string" && e.transcript.trim()) {
      byIndex.set(e.index, e.transcript);
    }
  }
  if (input.evidence.some((_, i) => !byIndex.has(i))) {
    return { ok: false, retry: true, error: "anonymizer dropped an evidence transcript" };
  }

  const narrator = input.narrator;
  let text = data.text;
  let transcripts = input.evidence.map((_, i) => replaceSelfSpeaker(byIndex.get(i) ?? "", narrator));
  const rawCombined = [input.text, ...input.evidence.map((e) => e.transcript)].join("\n\n");
  const anonCombined = [text, ...transcripts].join("\n\n");
  const normalized = normalizeNameMap(data.replacements, rawCombined, anonCombined, { narrator });
  // The narrator is structural: always exactly one { I -> narrator } entry, first.
  let entries = normalized.filter((m) => m.original !== "I");

  if (input.names) {
    const relabel = reconcileLabels(entries, input.names.known, input.names.keysFor);
    if (relabel.size > 0) {
      text = relabelText(text, relabel);
      transcripts = transcripts.map((t) => relabelText(t, relabel));
      entries = entries.map((m) => ({ ...m, replacement: relabel.get(m.replacement) ?? m.replacement }));
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
  const leak =
    findLeak(nameMap, outputs, input.names) ??
    (findLeak(
      rawOriginals(data.replacements).map((original) => ({ original, replacement: "" })),
      outputs,
    )
      ? "listed"
      : null);
  if (leak) return { ok: false, retry: true, error: `a ${leak} name survived anonymization` };
  const odd = unexplainedLabels(outputs, nameMap, input.roster?.labelsInUse);

  const people: KnownPerson[] = [];
  if (input.names) {
    const knownKeys = new Set(input.names.known.map((k) => k.key));
    for (const m of entries) {
      if (!isCaseLabel(m.replacement)) continue;
      for (const key of input.names.keysFor(m.original)) {
        if (knownKeys.has(key)) continue;
        knownKeys.add(key);
        people.push({ label: m.replacement, key });
      }
    }
  }

  const evidence: VerifiedEvidence[] = input.evidence.map((e, i) => ({ kind: e.kind, transcript: transcripts[i] }));
  return {
    ok: true,
    value: { text, evidence, nameMap, people },
    ...(odd.length ? { warning: `unexplained labels ${odd.join(",")}` } : {}),
  };
}

/**
 * One model call, plus one retry when the output is malformed, a name
 * survived, or the labels are inconsistent. A name that survives both
 * attempts throws AnonymizeError (callers must then neither judge nor store
 * anything, and must refund); inconsistent labels on the retry are accepted,
 * since no name leaks.
 */
export async function anonymizeSubmission(input: SubmissionInput): Promise<AnonymizedSubmission> {
  if (!hasApiKey()) throw new AnonymizeError("ANTHROPIC_API_KEY not set");
  const started = Date.now();
  let fallback: AnonymizedSubmission | null = null;
  let last = "";
  for (let i = 0; i < 2; i++) {
    const left = TOTAL_BUDGET_MS - (Date.now() - started);
    if (i > 0 && left < RETRY_MIN_MS) break;
    const res = await attempt(input, Math.min(ATTEMPT_TIMEOUT_MS, left));
    if (res.ok) {
      if (!res.warning || i > 0) return res.value;
      // Safe but inconsistent: kept in case the retry cannot do better.
      fallback = res.value;
      last = res.warning;
    } else {
      last = res.error;
      if (!res.retry) break;
    }
    console.warn(`[evidence] anonymize retry: ${last}`);
  }
  if (fallback) return fallback;
  throw new AnonymizeError(last);
}
