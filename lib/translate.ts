/**
 * Translation of a stored verdict's free text into the other UI language.
 *
 * Content keeps the language it was judged in; this produces a copy in the
 * viewer's language. Only the text travels: every non-empty text field is
 * sent as a numbered segment and comes back under the same number, so the
 * model never sees or returns the ruling's structure, and enums, numbers,
 * runs, ids and flags are copied from the original. A reply that misses a
 * segment, echoes the source or is not in the target language is retried
 * once at a higher effort and otherwise rejected. Each (verdict, language)
 * pair is translated at most once: an in-process pending map joins
 * concurrent requests, and the database primary key backs that up across
 * processes. A pair whose translation failed is not retried until a short
 * cooldown (growing with each failure) has passed, so a verdict that keeps
 * failing cannot cost model calls on every view.
 */

import { claudeJson, LITE_MODEL, type ClaudeJsonResult, type Effort } from "./claude";
import { verdictLang } from "./content-lang";
import { getTranslation, getVerdict, saveTranslation } from "./db";
import { contentLang, loadLocales, t, type Lang } from "./i18n";
import { LANGS } from "./langs";
import { z } from "zod";
import type { VerdictResult } from "./types";

/** Budget for one translation, retry included. A first attempt at low
 * effort takes seconds; the retry gets whatever is left. */
export const TRANSLATE_TIMEOUT_MS = 60_000;
/** A retry with less time than this left is not started. */
const MIN_RETRY_BUDGET_MS = 15_000;

/** Every free-text field of a VerdictResult, flattened. Arrays keep the
 * original order and length; null marks a group the verdict does not have. */
export type TranslatableText = {
  headline: string;
  /** Absent on verdicts stored before it existed. */
  why?: string;
  crux: string;
  split_points: string[] | null;
  conditional: { if_value: string; then: string }[] | null;
  side_a: string[];
  side_b: string[];
  bedrock_a: string;
  bedrock_b: string;
  facts_relied_on: string[];
  losing_side_best_point: string;
  lean_reason: string | null;
  crux_trial: { attack: string; reasoning: string } | null;
  /** Premium web fact-check claims. Present only when the verdict has a
   * "checked" fact-check; source titles and URLs are never translated. */
  fact_check?: { claim: string; summary: string }[];
  /** Two-sided case verdicts: present only when the verdict has them. */
  agreed_facts?: string[];
  disputed_facts?: { fact: string; party_a: string; party_b: string }[];
  would_change?: string[];
  /** Verdicts produced by an appeal: the one-sentence "what changed". */
  appeal_summary?: string;
};

/** Output schema (compact form, converted by toClaudeSchema). */
export const TRANSLATE_SCHEMA = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: { i: { type: "integer" }, text: { type: "string" } },
        required: ["i", "text"],
      },
    },
  },
  required: ["segments"],
} as const;

const SegmentsReply = z.object({
  segments: z.array(z.object({ i: z.number().int(), text: z.string() })),
});

export function extractText(r: VerdictResult): TranslatableText {
  return {
    headline: r.headline,
    ...(r.why !== undefined ? { why: r.why } : {}),
    crux: r.crux,
    split_points: r.split_points ? r.split_points.map((p) => p.point) : null,
    conditional: r.conditional ? r.conditional.map((c) => ({ if_value: c.if_value, then: c.then })) : null,
    side_a: r.argument_map.side_a.map((c) => c.claim),
    side_b: r.argument_map.side_b.map((c) => c.claim),
    bedrock_a: r.argument_map.bedrock_a,
    bedrock_b: r.argument_map.bedrock_b,
    facts_relied_on: [...r.facts_relied_on],
    losing_side_best_point: r.losing_side_best_point,
    lean_reason: r.lean ? r.lean.reason : null,
    crux_trial: r.crux_trial ? { attack: r.crux_trial.attack, reasoning: r.crux_trial.reasoning } : null,
    ...(r.fact_check?.status === "checked"
      ? { fact_check: r.fact_check.claims.map((c) => ({ claim: c.claim, summary: c.summary })) }
      : {}),
    ...(r.agreed_facts ? { agreed_facts: [...r.agreed_facts] } : {}),
    ...(r.disputed_facts
      ? { disputed_facts: r.disputed_facts.map((d) => ({ fact: d.fact, party_a: d.party_a, party_b: d.party_b })) }
      : {}),
    ...(r.would_change ? { would_change: [...r.would_change] } : {}),
    ...(r.appeal ? { appeal_summary: r.appeal.summary } : {}),
  };
}

/** Which field a flattened string came from; only some get a note. */
type Field = "headline" | "if_value" | "other";
type Slot = { field: Field; text: string };

/** Every string of `x` in a fixed order (absent groups contribute nothing).
 * unflattenText reads them back in the same order. */
export function flattenText(x: TranslatableText): Slot[] {
  const other = (text: string): Slot => ({ field: "other", text });
  return [
    { field: "headline", text: x.headline },
    ...(x.why === undefined ? [] : [other(x.why)]),
    other(x.crux),
    ...(x.split_points ?? []).map(other),
    ...(x.conditional ?? []).flatMap((c): Slot[] => [{ field: "if_value", text: c.if_value }, other(c.then)]),
    ...x.side_a.map(other),
    ...x.side_b.map(other),
    other(x.bedrock_a),
    other(x.bedrock_b),
    ...x.facts_relied_on.map(other),
    other(x.losing_side_best_point),
    ...(x.lean_reason === null ? [] : [other(x.lean_reason)]),
    ...(x.crux_trial ? [other(x.crux_trial.attack), other(x.crux_trial.reasoning)] : []),
    ...(x.fact_check ?? []).flatMap((c) => [other(c.claim), other(c.summary)]),
    ...(x.agreed_facts ?? []).map(other),
    ...(x.disputed_facts ?? []).flatMap((d) => [other(d.fact), other(d.party_a), other(d.party_b)]),
    ...(x.would_change ?? []).map(other),
    ...(x.appeal_summary === undefined ? [] : [other(x.appeal_summary)]),
  ];
}

/** Inverse of flattenText: `template`'s shape filled with `flat`, in order. */
export function unflattenText(template: TranslatableText, flat: readonly string[]): TranslatableText {
  let k = 0;
  const next = () => flat[k++] ?? "";
  const headline = next();
  const why = template.why === undefined ? undefined : next();
  const crux = next();
  const split_points = template.split_points ? template.split_points.map(() => next()) : null;
  const conditional = template.conditional
    ? template.conditional.map(() => {
        const if_value = next();
        return { if_value, then: next() };
      })
    : null;
  const side_a = template.side_a.map(() => next());
  const side_b = template.side_b.map(() => next());
  const bedrock_a = next();
  const bedrock_b = next();
  const facts_relied_on = template.facts_relied_on.map(() => next());
  const losing_side_best_point = next();
  const lean_reason = template.lean_reason === null ? null : next();
  const crux_trial = template.crux_trial
    ? (() => {
        const attack = next();
        return { attack, reasoning: next() };
      })()
    : null;
  const fact_check = template.fact_check?.map(() => {
    const claim = next();
    return { claim, summary: next() };
  });
  const agreed_facts = template.agreed_facts?.map(() => next());
  const disputed_facts = template.disputed_facts?.map(() => {
    const fact = next();
    const party_a = next();
    return { fact, party_a, party_b: next() };
  });
  const would_change = template.would_change?.map(() => next());
  const appeal_summary = template.appeal_summary === undefined ? undefined : next();
  return {
    headline,
    ...(why !== undefined ? { why } : {}),
    crux,
    split_points,
    conditional,
    side_a,
    side_b,
    bedrock_a,
    bedrock_b,
    facts_relied_on,
    losing_side_best_point,
    lean_reason,
    crux_trial,
    ...(fact_check ? { fact_check } : {}),
    ...(agreed_facts ? { agreed_facts } : {}),
    ...(disputed_facts ? { disputed_facts } : {}),
    ...(would_change ? { would_change } : {}),
    ...(appeal_summary !== undefined ? { appeal_summary } : {}),
  };
}

/** One unit of text sent to the model. `note` is context, never returned. */
export type Segment = { i: number; text: string; note?: string };

/** The segments sent for one verdict, and where each one goes back.
 * Strings with no letters (empty, a dash) are not sent and stay as they are. */
export type SegmentPlan = { slots: Slot[]; segments: Segment[]; slotOf: number[] };

const NOTES: Record<"en" | "tr", Partial<Record<Field, string>>> = {
  en: {
    headline: "headline, at most 10 words",
    if_value: 'condition clause printed after "If": no leading "If"',
  },
  tr: {
    headline: "headline, at most 10 words",
    if_value: 'condition clause printed after "Eğer": ends in -sa/-se, no leading "Eğer"',
  },
};

export function planSegments(text: TranslatableText, target: Lang): SegmentPlan {
  const slots = flattenText(text);
  const segments: Segment[] = [];
  const slotOf: number[] = [];
  slots.forEach((slot, k) => {
    if (!/\p{L}/u.test(slot.text)) return;
    const note = NOTES[target === "tr" ? "tr" : "en"][slot.field];
    segments.push({ i: segments.length, text: slot.text, ...(note ? { note } : {}) });
    slotOf.push(k);
  });
  return { slots, segments, slotOf };
}

/** The flattened strings with each segment's translation in its slot. */
export function reassemble(plan: SegmentPlan, translated: readonly string[]): string[] {
  const flat = plan.slots.map((s) => s.text);
  plan.slotOf.forEach((k, i) => (flat[k] = translated[i]));
  return flat;
}

const LABELS: Record<"en" | "tr", { a: string; b: string }> = {
  en: { a: "Party A", b: "Party B" },
  tr: { a: "Taraf A", b: "Taraf B" },
};

/** Turkish genitive after the letter names: "A'nın", "B'nin". */
const TR_GENITIVE: Record<"A" | "B", string> = { A: "nın", B: "nin" };

/** Vowel harmony for a suffix on a letter name: "A" is read "a" (back
 * vowel), "B" is read "be" (front vowel). */
const HARMONY: Record<"A" | "B", Record<string, string>> = {
  A: { e: "a", i: "ı", u: "ı", ü: "ı" },
  B: { a: "e", ı: "i", u: "i", ü: "i" },
};

/** An apostrophe plus a Turkish case suffix (dative, locative, ablative,
 * instrumental, accusative, genitive). Deliberately never matches English
 * contractions ('s, 'll, 'd, 've, 're, 'm). */
const TR_CASE_SUFFIX = "['’](?:y?[aeıiuü]|[dt][ae]n?|y?l[ae]|n[ae]|n?[ıiuü]n)(?!\\p{L})";

/** Turkish genitive after the letter name of a "Person C"-style placeholder:
 * most letter names end in a front vowel ("ce", "de"); I, O and U do not. */
function placeholderGenitive(x: string): string {
  return x === "I" ? "nın" : x === "O" || x === "U" ? "nun" : "nin";
}

/** Backstop for the prompt rule: every party label ends up as the target's
 * label with a target-language suffix. Into Turkish, an English genitive
 * ("Party A's", or "Taraf A's" from a half-done label) becomes "Taraf A'nın"
 * and a suffix with the wrong vowel ("Taraf B'ya") is harmonised. Into
 * English, a Turkish genitive ("Taraf B'nin", or "Party B'nin") becomes
 * "Party B's" and any other Turkish case suffix ("Taraf B'ye") is dropped.
 * Name placeholders ("Person C") keep their English form in both languages,
 * as the anonymizer writes them, and get the same suffix handling. */
export function mapPartyLabels(text: string, target: Lang): string {
  if (target === "tr") {
    return text
      .replace(/\b(?:Party|Taraf) ([AB])['’]s(?!\p{L})/gu, (_, x: "A" | "B") => `Taraf ${x}'${TR_GENITIVE[x]}`)
      .replace(/(?<!\p{L})(?:Person|Kişi) ([C-Z])['’]s(?!\p{L})/gu, (_, x: string) => `Person ${x}'${placeholderGenitive(x)}`)
      .replace(/(?<!\p{L})Kişi ([C-Z])\b/gu, "Person $1")
      .replace(new RegExp(`\\b${LABELS.en.a}\\b`, "g"), LABELS.tr.a)
      .replace(new RegExp(`\\b${LABELS.en.b}\\b`, "g"), LABELS.tr.b)
      .replace(
        // A final -ki / -ken is invariant: only the case suffix before it is harmonised.
        /\bTaraf ([AB])(['’])(\p{L}+?)(ki|ken)?(?!\p{L})/gu,
        (_, x: "A" | "B", apos: string, suffix: string, tail: string | undefined) =>
          `Taraf ${x}${apos}${suffix.replace(/[aeıiuü]/g, (v) => HARMONY[x][v] ?? v)}${tail ?? ""}`,
      );
  }
  return text
    .replace(/\b(?:Taraf|Party) ([AB])['’]n?[ıi]n(?:ki)?(?!\p{L})/gu, "Party $1's")
    .replace(new RegExp(`\\b(?:Taraf|Party) ([AB])${TR_CASE_SUFFIX}`, "gu"), "Party $1")
    .replace(/(?<!\p{L})(?:Person|Kişi) ([C-Z])['’]n?[ıiuü]n(?:ki)?(?!\p{L})/gu, "Person $1's")
    .replace(new RegExp(`(?<!\\p{L})(?:Person|Kişi) ([C-Z])${TR_CASE_SUFFIX}`, "gu"), "Person $1")
    .replace(/(?<!\p{L})Kişi ([C-Z])\b/gu, "Person $1")
    .replace(new RegExp(`\\b${LABELS.tr.a}\\b`, "g"), LABELS.en.a)
    .replace(new RegExp(`\\b${LABELS.tr.b}\\b`, "g"), LABELS.en.b);
}

/** Below this many letters of plain prose the language check abstains:
 * there is too little to judge, and the per-segment echo check still runs. */
const MIN_LETTERS_TO_JUDGE = 40;

/** Most Turkish-only letters English prose may carry once names and quotes
 * are set aside (a borrowed lowercase word); Turkish prose runs at 5% and up. */
const MAX_TR_LETTER_SHARE_IN_EN = 0.02;

/** The text minus quoted spans and capitalised words (names, places, sentence
 * openers), which keep their spelling in any language. */
function plainProse(text: string): string {
  return text
    .replace(/"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|«[^»\n]*»/g, " ")
    .replace(/(?<!\p{L})\p{Lu}[\p{L}\p{M}'’]*/gu, " ");
}

/** Whether translated text reads as the target language, so a reply that
 * echoes the source back is rejected instead of cached for good. Turkish
 * needs a Turkish-only letter or a Turkish party label somewhere; English
 * prose may hold at most a trace of Turkish-only letters. */
export function inTargetLanguage(texts: readonly string[], target: Lang): boolean {
  const joined = texts.join("\n");
  const prose = plainProse(joined);
  const letters = prose.match(/\p{L}/gu)?.length ?? 0;
  if (letters < MIN_LETTERS_TO_JUDGE) return true;
  if (target === "tr") return contentLang(joined) === "tr";
  const turkish = prose.match(/[ğıİşĞŞ]/g)?.length ?? 0;
  return turkish / letters <= MAX_TR_LETTER_SHARE_IN_EN;
}

/** A source segment this long cannot come back unchanged from a real
 * translation between English and Turkish. */
function mustChange(text: string): boolean {
  // Quoted spans and capitalised words (titles, product names) may stay as they are.
  const prose = plainProse(text);
  return (prose.match(/\p{L}/gu)?.length ?? 0) >= 20 && prose.trim().split(/\s+/).length >= 4;
}

function normalized(text: string, target: Lang): string {
  return mapPartyLabels(text, target).toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

export type SegmentCheck = { ok: true; texts: string[] } | { ok: false; error: string };

function list(ns: number[]): string {
  return ns.length > 5 ? `${ns.slice(0, 5).join(", ")} and ${ns.length - 5} more` : ns.join(", ");
}

/** Checks a model reply against the segments sent: every i exactly once,
 * nothing empty, no long segment echoed back, and the target language.
 * Returns the translations in segment order, or why the reply is unusable. */
export function checkSegments(segments: readonly Segment[], payload: unknown, target: Lang): SegmentCheck {
  const parsed = SegmentsReply.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "reply did not match the segment schema" };
  const byI = new Map<number, string>();
  for (const s of parsed.data.segments) {
    if (s.i < 0 || s.i >= segments.length) return { ok: false, error: `reply has unknown segment ${s.i}` };
    if (byI.has(s.i)) return { ok: false, error: `reply repeats segment ${s.i}` };
    byI.set(s.i, s.text);
  }
  const missing = segments.filter((s) => !(byI.get(s.i) ?? "").trim()).map((s) => s.i);
  if (missing.length) return { ok: false, error: `segments ${list(missing)} missing or empty` };
  const texts = segments.map((s) => byI.get(s.i)!);
  const echoed = segments
    .filter((s, i) => mustChange(s.text) && normalized(s.text, target) === normalized(texts[i], target))
    .map((s) => s.i);
  if (echoed.length) return { ok: false, error: `segments ${list(echoed)} came back untranslated` };
  if (!inTargetLanguage(texts, target)) return { ok: false, error: `translation is not in ${LANGS[target].name}` };
  return { ok: true, texts };
}

/** Puts translated text back into a copy of the original. Everything that
 * is not free text (verdict, confidence, kinds, parties, runs, outcome,
 * flags) comes from the original untouched. */
export function applyText(r: VerdictResult, text: TranslatableText, target: Lang): VerdictResult {
  const m = (s: string) => mapPartyLabels(s, target);
  return {
    ...r,
    headline: m(text.headline),
    ...(r.why !== undefined ? { why: m(text.why ?? r.why) } : {}),
    crux: m(text.crux),
    split_points: r.split_points
      ? r.split_points.map((p, i) => ({ ...p, point: m(text.split_points?.[i] ?? p.point) }))
      : r.split_points,
    conditional: r.conditional
      ? r.conditional.map((c, i) => ({
          if_value: m(text.conditional?.[i]?.if_value ?? c.if_value),
          then: m(text.conditional?.[i]?.then ?? c.then),
        }))
      : r.conditional,
    argument_map: {
      side_a: r.argument_map.side_a.map((c, i) => ({ ...c, claim: m(text.side_a[i] ?? c.claim) })),
      side_b: r.argument_map.side_b.map((c, i) => ({ ...c, claim: m(text.side_b[i] ?? c.claim) })),
      bedrock_a: m(text.bedrock_a),
      bedrock_b: m(text.bedrock_b),
    },
    facts_relied_on: r.facts_relied_on.map((f, i) => m(text.facts_relied_on[i] ?? f)),
    losing_side_best_point: m(text.losing_side_best_point),
    ...(r.lean ? { lean: { ...r.lean, reason: m(text.lean_reason ?? r.lean.reason) } } : {}),
    ...(r.crux_trial
      ? {
          crux_trial: {
            ...r.crux_trial,
            attack: m(text.crux_trial?.attack ?? r.crux_trial.attack),
            reasoning: m(text.crux_trial?.reasoning ?? r.crux_trial.reasoning),
          },
        }
      : {}),
    ...(r.fact_check?.status === "checked"
      ? {
          fact_check: {
            ...r.fact_check,
            claims: r.fact_check.claims.map((c, i) => ({
              ...c,
              claim: m(text.fact_check?.[i]?.claim ?? c.claim),
              summary: m(text.fact_check?.[i]?.summary ?? c.summary),
            })),
          },
        }
      : {}),
    ...(r.agreed_facts ? { agreed_facts: r.agreed_facts.map((f, i) => m(text.agreed_facts?.[i] ?? f)) } : {}),
    ...(r.disputed_facts
      ? {
          disputed_facts: r.disputed_facts.map((d, i) => ({
            ...d,
            fact: m(text.disputed_facts?.[i]?.fact ?? d.fact),
            party_a: m(text.disputed_facts?.[i]?.party_a ?? d.party_a),
            party_b: m(text.disputed_facts?.[i]?.party_b ?? d.party_b),
          })),
        }
      : {}),
    ...(r.would_change ? { would_change: r.would_change.map((w, i) => m(text.would_change?.[i] ?? w)) } : {}),
    ...(r.appeal ? { appeal: { ...r.appeal, summary: m(text.appeal_summary ?? r.appeal.summary) } } : {}),
    lang: target,
  };
}

/** One line on wording. Faithfulness stays first: the judges' full voice
 * rules (no named frameworks, say it bluntly) would rewrite what a ruling
 * says, so they are not part of this prompt. */
const NATURAL: Record<"en" | "tr", string> = {
  en: "Natural wording: write the everyday English a native speaker would use, not word-for-word translationese. Natural wording never overrides rule 1.",
  tr: 'Natural wording: write the everyday Turkish a native speaker would say, not word-for-word translationese or officialese. Use informal "sen", never "siz", wherever the text speaks to a reader. Natural wording never overrides rule 1.',
};

export function translateSystemPrompt(source: Lang, target: Lang): string {
  const from = LANGS[source].name;
  const to = LANGS[target].name;
  return `You are a careful translator for an argument-settling app. You translate the text of one written ruling from ${from} into ${to}, segment by segment.

RULES, in priority order:
1. Faithful meaning. Never add, drop, soften or strengthen anything. Keep every claim, number, unit, name, quote, hedge and degree of certainty exactly as strong as in the source. Don't correct, summarise or comment on the content.
2. Complete. Every input segment gets exactly one output segment with the same i, fully translated into ${to}. Never return a segment in ${from}.
3. Party labels map exactly: "Party A" <-> "Taraf A", "Party B" <-> "Taraf B". "Person C", "Person D" and so on stand in for other people's names and stay exactly as written in both languages. Never swap a label for a name or a pronoun.
4. ${NATURAL[target === "tr" ? "tr" : "en"]}`;
}

/** The label rule for one direction, with the suffix handling spelled out. */
const PARTY_RULE: Record<"en" | "tr", string> = {
  en: `Party labels: "Taraf A" is "Party A" and "Taraf B" is "Party B". Turn a Turkish case suffix on a label into English grammar and drop it from the label: "Taraf A'nın" -> "Party A's", "Taraf B'nin" -> "Party B's", "Taraf B'ye" -> "to Party B", "Taraf A'dan" -> "from Party A". Never leave a Turkish suffix on "Party A" or "Party B". "Person C", "Person D" and so on are name placeholders: keep them as written, with English grammar ("Person C'nin" -> "Person C's").`,
  tr: `Party labels: "Party A" is "Taraf A" and "Party B" is "Taraf B". Give the label the Turkish suffix the sentence needs, after an apostrophe and in harmony with how the letter is read (A is "a", B is "be"): "Party A's" -> "Taraf A'nın", "Party B's" -> "Taraf B'nin", "to Party A" -> "Taraf A'ya", "to Party B" -> "Taraf B'ye", "from Party B" -> "Taraf B'den". Never leave "'s" on "Taraf A" or "Taraf B". "Person C", "Person D" and so on are name placeholders: keep them in English, untranslated, with any Turkish suffix after an apostrophe ("Person C's" -> "Person C'nin").`,
};

/** The user message: the instruction, the label rule, the numbered
 * segments, and a closing line. `rejected` (the reason the previous reply
 * failed) adds a firmer reminder for the retry. */
export function translateUserMessage(
  source: Lang,
  target: Lang,
  segments: readonly Segment[],
  rejected?: string,
): string {
  const from = LANGS[source].name;
  const to = LANGS[target].name;
  const last = segments.length - 1;
  const parts = [
    `Translate every segment from ${from} to ${to}. Return the same i values: {"segments": [{"i": 0, "text": "<${to} translation of segment 0>"}, ...]}, exactly one item per input segment. Translate every segment, short ones too. Don't merge, split, skip or add segments, and leave no ${from} text behind.`,
    PARTY_RULE[target === "tr" ? "tr" : "en"],
  ];
  if (segments.some((s) => s.note)) parts.push(`A segment's "note" is context for you. Don't translate it or return it.`);
  if (rejected) {
    parts.push(
      `IMPORTANT: your previous answer was rejected (${rejected}). Rewrite every segment in ${to}. Returning the ${from} text unchanged is wrong.`,
    );
  }
  parts.push(`Segments (${from}):\n[\n${segments.map((s) => JSON.stringify(s)).join(",\n")}\n]`);
  parts.push(`Return all ${segments.length} segments (i = 0 to ${last}), each translated into ${to}.`);
  return parts.join("\n\n");
}

export type TranslateDeps = {
  call?: (call: Parameters<typeof claudeJson>[0]) => Promise<ClaudeJsonResult<unknown>>;
  /** Clock for the failure cooldown and the retry budget (tests). */
  now?: () => number;
};

/** Model refusals are stored with dictionary text, so they translate from
 * the dictionary: no model call for text the model would not write. */
function refusedCopy(r: VerdictResult, target: Lang): VerdictResult {
  const claim = t(target, "refused.claim");
  return {
    ...r,
    headline: t(target, "refused.headline"),
    crux: t(target, "refused.crux"),
    argument_map: {
      ...r.argument_map,
      side_a: r.argument_map.side_a.map((c) => ({ ...c, claim })),
      side_b: r.argument_map.side_b.map((c) => ({ ...c, claim })),
    },
    losing_side_best_point: t(target, "refused.bestPoint"),
    lang: target,
  };
}

type Attempt = { ok: true; texts: string[] } | { ok: false; error: string; retryable: boolean };

/** Call errors that are a bad reply rather than a failed request. The SDK
 * already retried the transport; a timeout or refusal is not retried. */
const RETRYABLE_CALL_ERROR = /max_tokens|not valid JSON|empty response/;

/** Translates one verdict's text into `target`. Never returns partial
 * output: any failure (call error, refusal, unusable reply after the retry)
 * is an error. */
export async function translateResult(
  result: VerdictResult,
  target: Lang,
  deps: TranslateDeps = {},
): Promise<{ ok: true; result: VerdictResult } | { ok: false; error: string }> {
  const source = verdictLang(result);
  if (source === target) return { ok: true, result };
  await loadLocales();
  if (result.model_refused) return { ok: true, result: refusedCopy(result, target) };

  const text = extractText(result);
  const plan = planSegments(text, target);
  const done = (texts: string[]) => ({
    ok: true as const,
    result: applyText(result, unflattenText(text, reassemble(plan, texts)), target),
  });
  if (plan.segments.length === 0) return done([]);

  const call = deps.call ?? claudeJson;
  const now = deps.now ?? Date.now;
  const start = now();
  const attempt = async (effort: Effort, timeoutMs: number, rejected?: string): Promise<Attempt> => {
    const res = await call({
      system: translateSystemPrompt(source, target),
      user: translateUserMessage(source, target, plan.segments, rejected),
      schema: TRANSLATE_SCHEMA,
      model: LITE_MODEL,
      effort,
      timeoutMs,
    });
    if (!res.ok) {
      return res.blocked
        ? { ok: false, error: `refused: ${res.reason}`, retryable: false }
        : { ok: false, error: res.error, retryable: RETRYABLE_CALL_ERROR.test(res.error) };
    }
    const checked = checkSegments(plan.segments, res.data, target);
    return checked.ok ? checked : { ...checked, retryable: true };
  };

  const first = await attempt("low", TRANSLATE_TIMEOUT_MS);
  if (first.ok) return done(first.texts);
  const left = TRANSLATE_TIMEOUT_MS - (now() - start);
  if (!first.retryable || left < MIN_RETRY_BUDGET_MS) return { ok: false, error: first.error };
  // A reply cut off at max_tokens is retried at the same low effort: more
  // thinking would make another cut-off likelier.
  const retryEffort: Effort = /max_tokens/.test(first.error) ? "low" : "medium";
  console.warn(`[translate] ${source} -> ${target} rejected (${first.error}); retrying at ${retryEffort} effort`);
  const second = await attempt(retryEffort, left, first.error);
  if (second.ok) return done(second.texts);
  return { ok: false, error: `${second.error} (retry; first attempt: ${first.error})` };
}

export type TranslationOutcome<G> =
  | { status: "ok"; result: VerdictResult; source: Lang; translated: boolean }
  | { status: "not_found" }
  | { status: "gated"; reason: G }
  | { status: "failed" };

// Survives Next.js dev hot reloads, like the database client.
const globalForTranslate = globalThis as unknown as {
  __verdictTranslations?: Map<string, Promise<VerdictResult | null>>;
};
function pending(): Map<string, Promise<VerdictResult | null>> {
  return (globalForTranslate.__verdictTranslations ??= new Map());
}

/** Number of translations in flight in this process (for tests). */
export function pendingTranslations(): number {
  return pending().size;
}

/** Cooldown after a pair's first failure; it doubles with each further
 * failure up to the cap. Short at first, so a reader who toggles the
 * language again after a one-off blip gets a fresh attempt; a pair that
 * always fails settles at one attempt (at most two calls) per ten minutes. */
export const FAILURE_COOLDOWN_MS = 10_000;
export const MAX_FAILURE_COOLDOWN_MS = 10 * 60_000;

type Failure = { count: number; until: number };
const globalForFailures = globalThis as unknown as { __verdictTranslateFailures?: Map<string, Failure> };
function failures(): Map<string, Failure> {
  return (globalForFailures.__verdictTranslateFailures ??= new Map());
}

function noteFailure(key: string, now: number): void {
  const map = failures();
  // Entries long past their cooldown carry no information worth keeping.
  for (const [k, f] of map) if (f.until <= now - MAX_FAILURE_COOLDOWN_MS) map.delete(k);
  const count = (map.get(key)?.count ?? 0) + 1;
  const wait = Math.min(FAILURE_COOLDOWN_MS * 2 ** (count - 1), MAX_FAILURE_COOLDOWN_MS);
  map.set(key, { count, until: now + wait });
}

/** Forgets every recorded failure (for tests). */
export function clearTranslationFailures(): void {
  failures().clear();
}

/** Re-checks the store (a job that just finished may have written it), then
 * translates and stores. Resolves null on failure; never rejects. A failed
 * model call writes nothing. */
async function runJob(id: string, original: VerdictResult, target: Lang, deps: TranslateDeps) {
  const key = `${id}:${target}`;
  const now = deps.now ?? Date.now;
  try {
    const cached = await getTranslation(id, target);
    if (cached) return cached;
    const res = await translateResult(original, target, deps);
    if (!res.ok) {
      console.error(`[translate] ${id} -> ${target} failed:`, res.error);
      noteFailure(key, now());
      return null;
    }
    failures().delete(key);
    try {
      await saveTranslation(id, target, res.result);
      // Another process may have stored the pair first; serve the stored copy
      // so every viewer sees the same text.
      return (await getTranslation(id, target)) ?? res.result;
    } catch (e) {
      console.error("[translate] saving failed:", e instanceof Error ? e.message : String(e));
      return res.result;
    }
  } catch (e) {
    console.error(`[translate] ${id} -> ${target} failed:`, e instanceof Error ? e.message : String(e));
    noteFailure(key, now());
    return null;
  }
}

/**
 * The verdict `id` in language `target`: the original when it is already in
 * that language, else the stored translation, else a new one. `gate` runs
 * only right before a NEW translation would be computed (the rate limit);
 * a non-null return refuses it. Requests that find a translation already in
 * flight join it and are never gated. A pair still cooling down after a
 * failure is "failed" with no gate and no call. Database read errors
 * propagate.
 */
export async function translatedVerdict<G>(
  id: string,
  target: Lang,
  gate: () => Promise<G | null>,
  deps: TranslateDeps = {},
): Promise<TranslationOutcome<G>> {
  const stored = await getVerdict(id);
  if (!stored) return { status: "not_found" };
  const source = verdictLang(stored.result);
  if (source === target) return { status: "ok", result: stored.result, source, translated: false };

  const key = `${id}:${target}`;
  let job = pending().get(key);
  if (!job) {
    const cached = await getTranslation(id, target);
    if (cached) return { status: "ok", result: cached, source, translated: true };
    job = pending().get(key);
  }
  if (!job) {
    const failure = failures().get(key);
    if (failure && failure.until > (deps.now ?? Date.now)()) return { status: "failed" };
    // One allowed gate check can cost up to 2 model calls (first attempt plus retry).
    const refused = await gate();
    if (refused !== null) return { status: "gated", reason: refused };
    // Checked again with no await before the set, so two requests in this
    // process can never both start a job for the same pair.
    job = pending().get(key);
    if (!job) {
      const created = runJob(id, stored.result, target, deps);
      pending().set(key, created);
      void created.finally(() => pending().delete(key));
      job = created;
    }
  }
  const result = await job;
  return result ? { status: "ok", result, source, translated: true } : { status: "failed" };
}
