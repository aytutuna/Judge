/**
 * Pure helpers for the premium request: clarification answers folded into
 * the argument text, and the optional Idempotency-Key header.
 */

import type { Lang } from "../i18n";
import type { Clarification } from "../types";

const LABELS: Record<Lang, { heading: string; q: string; a: string }> = {
  en: { heading: "More details from the person asking:", q: "Q", a: "A" },
  tr: { heading: "Soran kişiden ek bilgiler:", q: "S", a: "C" },
};

/**
 * The argument with the answered clarifying questions appended. Skipped
 * (empty) answers are dropped; with nothing answered the argument comes back
 * unchanged. The combined text is what gets anonymized, judged and stored,
 * so names in the answers are replaced like names in the argument.
 */
export function withClarifications(
  argument: string,
  clarifications: Clarification[] | undefined,
  lang: Lang,
): string {
  const answered = (clarifications ?? [])
    .map((c) => ({ question: c.question.trim(), answer: c.answer.trim() }))
    .filter((c) => c.question && c.answer);
  if (answered.length === 0) return argument;
  const l = LABELS[lang];
  const lines = answered.map((c) => `- ${l.q}: ${c.question}\n  ${l.a}: ${c.answer}`);
  return `${argument}\n\n${l.heading}\n${lines.join("\n")}`;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,64}$/;

/** The Idempotency-Key header: absent -> undefined, valid -> the key,
 * anything else -> null (a 400). */
export function idempotencyKey(headers: Headers): string | undefined | null {
  const raw = headers.get("idempotency-key");
  if (raw === null) return undefined;
  return IDEMPOTENCY_KEY.test(raw) ? raw : null;
}
