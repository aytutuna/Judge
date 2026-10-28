import { useEffect, useRef, useState } from "react";
import { verdictLang } from "./content-lang";
import type { Lang } from "./i18n";
import type { ClaimKind, DisputeType, FinalVerdict, JudgeVerdict, VerdictResult } from "./types";

/**
 * Client side of verdict translation: the verdict text follows the chosen
 * language. The original stays in memory next to every fetched translation,
 * so switching back is instant and each language is fetched once per page.
 *
 * Type-only imports from ./types on purpose: this module ships in the
 * initial JS of the home and share pages, and a value import would pull zod
 * in with it. The server validates with the zod schema (lib/translate.ts and
 * the translate route); the client only runs the light shape check below.
 */

export const FINAL_VERDICTS = [
  "side_a",
  "side_b",
  "split",
  "conditional",
  "dissolved",
  "too_close",
] as const satisfies readonly FinalVerdict[];
export const JUDGE_VERDICTS = [
  "side_a",
  "side_b",
  "split",
  "conditional",
  "dissolved",
] as const satisfies readonly JudgeVerdict[];
export const DISPUTE_TYPES = [
  "factual",
  "logical",
  "definitional",
  "values",
  "mixed",
] as const satisfies readonly DisputeType[];
export const CLAIM_KINDS = ["fact", "value", "definition", "logic"] as const satisfies readonly ClaimKind[];

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const oneOf = (list: readonly string[], x: unknown) => isStr(x) && list.includes(x);
const isClaims = (x: unknown) =>
  Array.isArray(x) && x.length > 0 && x.every((c) => isObj(c) && isStr(c.claim) && oneOf(CLAIM_KINDS, c.kind));

/** Light structural check of a verdict from the translate endpoint: the
 * fields the card renders, with the types it relies on. Not a full schema
 * (the server already ran one); it keeps a malformed body from crashing the
 * render, in which case the caller keeps the original. */
export function looksLikeVerdict(x: unknown): x is VerdictResult {
  if (!isObj(x)) return false;
  const map = x.argument_map;
  return (
    oneOf(FINAL_VERDICTS, x.verdict) &&
    oneOf(DISPUTE_TYPES, x.dispute_type) &&
    isStr(x.headline) &&
    (x.why === undefined || isStr(x.why)) &&
    isStr(x.crux) &&
    isStr(x.losing_side_best_point) &&
    Number.isInteger(x.confidence) &&
    (x.confidence as number) >= 1 &&
    (x.confidence as number) <= 5 &&
    Array.isArray(x.runs) &&
    x.runs.every((r) => oneOf(JUDGE_VERDICTS, r)) &&
    Array.isArray(x.facts_relied_on) &&
    x.facts_relied_on.every(isStr) &&
    (x.split_points === null || Array.isArray(x.split_points)) &&
    (x.conditional === null || Array.isArray(x.conditional)) &&
    typeof x.demo === "boolean" &&
    isObj(map) &&
    isClaims(map.side_a) &&
    isClaims(map.side_b) &&
    isStr(map.bedrock_a) &&
    isStr(map.bedrock_b)
  );
}

export type TranslationStatus = "original" | "loading" | "translated" | "error";

export type TranslationView = {
  /** What to render: the translation when ready, else the original. */
  result: VerdictResult;
  status: TranslationStatus;
  /** Language the original was written in. */
  source: Lang;
};

/** A fetched translation, or a failure: "error" is retried the next time the
 * language changes; "blocked" (rate limited) is not retried until the
 * server's Retry-After has passed, when it turns back into "error". */
export type TranslationEntry = VerdictResult | "error" | "blocked";

/** Pure: what to show for `lang`, given the original and the entry fetched
 * for that language so far (undefined while none has arrived). */
export function translationView(
  original: VerdictResult,
  lang: Lang,
  entry: TranslationEntry | undefined,
): TranslationView {
  const source = verdictLang(original);
  if (source === lang) return { result: original, status: "original", source };
  if (entry === undefined) return { result: original, status: "loading", source };
  if (entry === "error" || entry === "blocked") return { result: original, status: "error", source };
  return { result: entry, status: "translated", source };
}

/** Pure: the entries with every retryable failure dropped, so the next
 * visit to that language fetches again. Returns `entries` itself when there
 * is nothing to drop. */
export function dropRetryable(
  entries: Record<string, TranslationEntry>,
): Record<string, TranslationEntry> {
  if (!Object.values(entries).includes("error")) return entries;
  return Object.fromEntries(Object.entries(entries).filter(([, e]) => e !== "error"));
}

/** Why a fetch failed: `retryAfterSec` is set when the server rate limited
 * the request and said how long to wait. */
export type TranslationFailure = { failed: true; retryAfterSec: number | null };

/** Longest wait honoured from a Retry-After header. */
const MAX_RETRY_AFTER_SEC = 600;

function retryAfter(res: Response): number | null {
  if (res.status !== 429) return null;
  const sec = Number(res.headers.get("Retry-After"));
  return Number.isFinite(sec) && sec > 0 ? Math.min(sec, MAX_RETRY_AFTER_SEC) : null;
}

/** Fetches the verdict text in `lang`. A failure (network, HTTP error, or a
 * body that does not parse) comes back as a TranslationFailure; the caller
 * keeps the original. */
export async function fetchTranslation(
  id: string,
  lang: Lang,
  fetchImpl: typeof fetch = fetch,
): Promise<VerdictResult | TranslationFailure> {
  try {
    const res = await fetchImpl(
      `/api/verdict/${encodeURIComponent(id)}/translate?lang=${lang}`,
      { method: "POST" },
    );
    if (!res.ok) return { failed: true, retryAfterSec: retryAfter(res) };
    const body: unknown = await res.json();
    return isObj(body) && body.lang === lang && looksLikeVerdict(body.result)
      ? body.result
      : { failed: true, retryAfterSec: null };
  } catch {
    return { failed: true, retryAfterSec: null };
  }
}

/** The verdict `id` as it should read in `lang`. Fetches a translation when
 * the original is in the other language. A failed fetch shows the original
 * with an error note until the language changes; switching away and back
 * tries again (after Retry-After, when the server rate limited it). */
export function useVerdictTranslation(
  id: string | undefined,
  original: VerdictResult,
  lang: Lang,
): TranslationView {
  const [entries, setEntries] = useState<Record<string, TranslationEntry>>({});
  const [prevLang, setPrevLang] = useState(lang);
  const inFlight = useRef(new Set<string>());
  const needed = id !== undefined && verdictLang(original) !== lang;
  const key = `${id ?? ""}:${lang}`;

  // Adjusting state while rendering (React's pattern for reacting to a prop
  // change): a language change forgets retryable failures, so the next
  // visit to that language fetches again.
  let current = entries;
  if (prevLang !== lang) {
    setPrevLang(lang);
    current = dropRetryable(entries);
    if (current !== entries) setEntries(current);
  }
  const entry = needed ? current[key] : undefined;

  useEffect(() => {
    if (!needed || id === undefined || entry !== undefined || inFlight.current.has(key)) return;
    inFlight.current.add(key);
    void fetchTranslation(id, lang).then((out) => {
      inFlight.current.delete(key);
      if (!("failed" in out)) {
        setEntries((prev) => ({ ...prev, [key]: out }));
        return;
      }
      if (out.retryAfterSec === null) {
        setEntries((prev) => ({ ...prev, [key]: "error" }));
        return;
      }
      setEntries((prev) => ({ ...prev, [key]: "blocked" }));
      setTimeout(() => {
        setEntries((prev) => (prev[key] === "blocked" ? { ...prev, [key]: "error" } : prev));
      }, out.retryAfterSec * 1000);
    });
  }, [needed, id, lang, key, entry]);

  // Without an id there is nothing to translate from: show the original.
  if (id === undefined) return { result: original, status: "original", source: verdictLang(original) };
  return translationView(original, lang, entry);
}
