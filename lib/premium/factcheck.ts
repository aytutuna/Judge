/**
 * Premium fact-check: one Claude call with the server-side web search tool,
 * run on the anonymized text before the judges. The model decides whether
 * anything is checkable (a values dispute costs no search). Only sources
 * that really came back from the searches are kept, and the result is
 * evidence for the judges, not a ruling.
 *
 * Failure-open: any error, refusal or timeout gives "unavailable" and the
 * judges rule without it.
 */

import { claudeSearchJson, type Effort } from "../claude";
import { loadLocales, voiceNote, type Lang } from "../i18n";
import { LANGS } from "../langs";
import { FactStatus, type FactCheck, type FactClaim, type FactSource } from "../types";

export const FACTCHECK_TIMEOUT_MS = 40_000;

const MAX_CLAIMS = 3;
const MAX_SOURCES = 3;
const MAX_TITLE = 200;
const MAX_CLAIM = 300;
const MAX_SUMMARY = 500;

export const FACTCHECK_SYSTEM = `You fact-check the checkable factual claims in a two-party dispute. Use the search tool to check specifics that may have changed since your training, even when you feel confident. Search for each decisive factual claim (at most 3 claims) before answering. If the dispute has no checkable factual claim (pure values, taste or the meaning of a word), do not search and return an empty claims array. For each claim give a status (supported / refuted / mixed / unverified), a one-sentence summary in plain words, and the search results that back the status. Only cite URLs that appeared in your search results. Refer to the parties as Party A and Party B.`;

const TR_FACTCHECK_BLOCK = `

LANGUAGE: Write each claim and summary in Turkish, in everyday words, addressing the reader with informal "sen", never "siz". Refer to the parties as "Taraf A" and "Taraf B". Keep every source title and URL exactly as it appeared in the search results, untranslated. Keep the status values exactly as specified in the schema (English identifiers).`;

function factCheckLanguageBlock(lang: Lang): string {
  if (lang === "en") return "";
  if (lang === "tr") return TR_FACTCHECK_BLOCK;
  const voice = voiceNote(lang);
  return `

LANGUAGE: Write each claim and summary in ${LANGS[lang].name}, in everyday words.${voice ? ` ${voice}` : ""} Keep every source title and URL exactly as it appeared in the search results, untranslated. Keep the status values exactly as specified in the schema (English identifiers).`;
}

/** Output schema (compact form, converted by toClaudeSchema). */
export const FACTCHECK_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          status: { type: "string", enum: ["supported", "refuted", "mixed", "unverified"] },
          summary: { type: "string" },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: { title: { type: "string" }, url: { type: "string" } },
              required: ["title", "url"],
            },
          },
        },
        required: ["claim", "status", "summary", "sources"],
      },
    },
  },
  required: ["claims"],
} as const;

const UNAVAILABLE: FactCheck = { status: "unavailable", claims: [] };
const NONE: FactCheck = { status: "none", claims: [] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Comparison form of a URL: no fragment, no trailing slash on the path. */
function urlKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

function isHttp(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

/**
 * The model's fact-check reduced to what can be shown and trusted: sources
 * must be http(s) URLs that the searches returned (exact URL or the same URL
 * without fragment/trailing slash), deduped, at most 3 per claim and 3
 * claims; a claim left without a source is "unverified". No search at all
 * (and no results) means nothing was checkable ("none"); a payload that is
 * not the schema is "unavailable". Pure.
 */
export function sanitizeFactCheck(raw: unknown, searches: number, results: Map<string, string>): FactCheck {
  if (searches <= 0 && results.size === 0) return NONE;
  if (!isRecord(raw) || !Array.isArray(raw.claims)) return UNAVAILABLE;

  const known = new Map<string, { url: string; title: string }>();
  for (const [url, title] of results) {
    if (!known.has(urlKey(url))) known.set(urlKey(url), { url, title });
  }

  const claims: FactClaim[] = [];
  for (const item of raw.claims) {
    if (claims.length >= MAX_CLAIMS) break;
    if (!isRecord(item)) return UNAVAILABLE;
    const status = FactStatus.safeParse(item.status);
    if (typeof item.claim !== "string" || typeof item.summary !== "string" || !status.success) {
      return UNAVAILABLE;
    }
    if (!item.claim.trim()) continue;

    const sources: FactSource[] = [];
    const seen = new Set<string>();
    for (const s of Array.isArray(item.sources) ? item.sources : []) {
      if (sources.length >= MAX_SOURCES) break;
      if (!isRecord(s) || typeof s.url !== "string") continue;
      const url = s.url.trim();
      if (!isHttp(url)) continue;
      const hit = results.has(url) ? { url, title: results.get(url) ?? "" } : known.get(urlKey(url));
      if (!hit || !isHttp(hit.url)) continue;
      const key = urlKey(hit.url);
      if (seen.has(key)) continue;
      seen.add(key);
      const title = typeof s.title === "string" && s.title.trim() ? s.title : hit.title || new URL(hit.url).hostname;
      sources.push({ title: clip(title, MAX_TITLE), url: hit.url });
    }

    claims.push({
      claim: clip(item.claim, MAX_CLAIM),
      status: sources.length ? status.data : "unverified",
      summary: clip(item.summary, MAX_SUMMARY),
      sources,
    });
  }
  // Searched, but nothing came back worth showing: treat as nothing checkable.
  return claims.length ? { status: "checked", claims } : NONE;
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The FACT-CHECK block appended to the premium judges' user message, or
 * null when there is nothing checked to show them. */
export function factCheckBlock(fc: FactCheck): string | null {
  if (fc.status !== "checked" || fc.claims.length === 0) return null;
  const lines = fc.claims.map((c, i) => {
    const domains = [...new Set(c.sources.map((s) => domain(s.url)))];
    const sources = domains.length ? `sources: ${domains.join(", ")}` : "no sources found";
    return `${i + 1}. [${c.status}] ${c.claim} - ${c.summary} (${sources})`;
  });
  return `FACT-CHECK (web search run before judging; evidence, not a ruling):\n${lines.join("\n")}`;
}

function factCheckModel(): string {
  return process.env.PREMIUM_FACTCHECK_MODEL?.trim() || "claude-haiku-5-5";
}

function maxSearches(): number {
  const n = Number(process.env.PREMIUM_FACTCHECK_MAX_SEARCHES?.trim());
  return Number.isFinite(n) && n > 0 ? Math.min(5, Math.max(1, Math.floor(n))) : 3;
}

/** Low effort: Haiku decides quickly whether to search, and the searches do
 * the real work. */
const FACTCHECK_EFFORT: Effort = "low";

/** Runs the fact-check on the anonymized text. Never throws. */
export async function runFactCheck(anonymizedText: string, lang: Lang): Promise<FactCheck> {
  try {
    await loadLocales();
    const res = await claudeSearchJson<unknown>({
      system: `${FACTCHECK_SYSTEM}${factCheckLanguageBlock(lang)}`,
      user: `THE DISPUTE:\n\n${anonymizedText}`,
      schema: FACTCHECK_SCHEMA as unknown as Record<string, unknown>,
      model: factCheckModel(),
      effort: FACTCHECK_EFFORT,
      timeoutMs: FACTCHECK_TIMEOUT_MS,
      maxSearches: maxSearches(),
    });
    if (!res.ok) {
      console.warn("[factcheck] unavailable:", res.blocked ? `blocked (${res.reason})` : res.error);
      return UNAVAILABLE;
    }
    return sanitizeFactCheck(res.data, res.searches, res.results);
  } catch (e) {
    console.warn("[factcheck] failed open:", e instanceof Error ? e.message : String(e));
    return UNAVAILABLE;
  }
}
