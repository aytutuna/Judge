/**
 * Stored originals, display names and removal: shapes, validation and pure
 * helpers shared by the server, the website and the mobile app. Pure module:
 * no Node, DOM or Next imports.
 *
 * Every submission's original (the text exactly as received, Premium's
 * clarification answers, raw screenshot transcripts and the name map) is
 * kept encrypted on the server, readable only by its writer (and the
 * operator, with the key). Share pages show the writer's chosen display
 * names, never the raw map.
 */

import { z } from "zod";
import type { Lang } from "./i18n";
import { bareName, canonicalLabel, EN_SELF, isSelfOriginal, resolveParties } from "./names";
import type { EvidenceKind, NameMapping, VerdictResult } from "./types";

export type OriginalPayload = {
  v: 1;
  /** Exactly as received in the request body (the raw string, before trimming). */
  text: string;
  /** Premium only: the questions and answers as sent (skipped answers kept as ""). */
  clarifications?: { question: string; answer: string }[];
  /** Raw rendered transcripts from the verified evidence tokens, in submission order. */
  evidence?: { kind: EvidenceKind; transcript: string }[];
  /** The normalized map the anonymizer returned for this submission (original -> label). */
  nameMap: NameMapping[];
};

/** Public names per label. Null = the label is shown. `others` keys are "Person C".."Person Z". */
export type DisplayNames = { a: string | null; b: string | null; others: Record<string, string> };

/** Display names plus the owner's switch, as the owner sees them. */
export type DisplayState = DisplayNames & { namesVisible: boolean };

export type RemovalReason = "owner" | "party_a" | "party_b" | "account_deleted" | "operator";

/** "stored": readable; "not_stored": legacy or no key at the time; "removed":
 * blanked on request; "unreadable": decryption failed (logged). */
export type OriginalStatus = "stored" | "not_stored" | "removed" | "unreadable";

export const EMPTY_DISPLAY: DisplayNames = { a: null, b: null, others: {} };

/** Owner tokens: 32 random bytes, base64url (43 characters). */
export const OWNER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Header carrying the owner token. Never a URL or query parameter. */
export const OWNER_TOKEN_HEADER = "X-Owner-Token";

/** Where a client keeps a signed-out writer's token (web: localStorage;
 * mobile: secure storage under the same name). */
export function ownerTokenKey(verdictId: string): string {
  return `judge.owner.${verdictId}`;
}

const OTHER_LABEL = /^Person [C-Z]$/;

/** A display name as typed: NFC, inner whitespace collapsed, 1 to 40
 * characters, no control or format characters, no angle brackets, and never
 * a party label ("Party A", "Taraf B'ye", "Kişi C"). */
export const DisplayNameInput = z
  .string()
  .max(200)
  .transform((s) => s.normalize("NFC").replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(40)
      .refine((s) => !/[\p{Cc}\p{Cf}<>]/u.test(s), "invalid")
      .refine((s) => canonicalLabel(s) === null, "invalid"),
  );

/** A typed display name, or null for an empty field (the label is shown).
 * Undefined when the value is not acceptable. */
export function parseDisplayName(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return undefined;
  if (!raw.trim()) return null;
  const parsed = DisplayNameInput.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** PATCH /api/v1/verdicts/{id}/display body. Every field optional; null
 * clears a name back to its label. */
export const VerdictDisplayPatch = z
  .object({
    namesVisible: z.boolean().optional(),
    a: DisplayNameInput.nullable().optional(),
    b: DisplayNameInput.nullable().optional(),
    others: z
      .record(z.string().regex(OTHER_LABEL), DisplayNameInput.nullable())
      .refine((r) => Object.keys(r).length <= 24, "too many")
      .optional(),
  })
  .strict();
export type VerdictDisplayPatch = z.infer<typeof VerdictDisplayPatch>;

/** PATCH /api/v1/cases/{id}/display (owner) and /respond/{token}/display. */
export const CaseDisplayPatch = z
  .object({
    namesVisible: z.boolean().optional(),
    displayName: DisplayNameInput.nullable().optional(),
    /** Respondent only, signed out: the claim secret from answering. */
    claim: z.string().max(64).optional(),
  })
  .strict();
export type CaseDisplayPatch = z.infer<typeof CaseDisplayPatch>;

/** POST .../removal body. */
export const RemovalRequest = z.object({ confirm: z.literal("remove"), claim: z.string().max(64).optional() });

/** First name for a default: the bare name's first word, capitalized,
 * letters (plus apostrophes and hyphens) only, 2 to 40 characters.
 * Descriptions ("my roommate"), usernames and one-letter names give null. */
export function firstNameOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const first = bareName(name).trim().split(/\s+/u)[0] ?? "";
  if (EN_SELF.test(first)) return null;
  return /^\p{Lu}[\p{L}'’-]{1,39}$/u.test(first) ? first : null;
}

/** One-sided defaults from the writer's map: Party B and Person C..Z get
 * the first name the writer used for them; Party A (normally the writer)
 * stays null until the writer chooses a name. When the map puts the
 * narrator's pronoun on a "Person X" label (a bystander telling about two
 * other people), Party A is not the writer and gets their first name too,
 * and that pronoun ("Ben", "I") is never a name (resolveParties skips it). */
export function defaultDisplay(nameMap: readonly NameMapping[], lang: Lang): DisplayNames {
  const parties = resolveParties([...nameMap], lang, "A");
  const narratorElsewhere = nameMap.some((m) => {
    const label = canonicalLabel(m.replacement);
    return label !== null && label.startsWith("Person ") && isSelfOriginal(bareName(m.original), lang);
  });
  const out: DisplayNames = { a: null, b: null, others: {} };
  for (const [letter, party] of parties) {
    if (party.self || (letter === "A" && !narratorElsewhere)) continue;
    const first = firstNameOf(party.name);
    if (!first) continue;
    if (letter === "A") out.a = first;
    else if (letter === "B") out.b = first;
    else out.others[`Person ${letter}`] = first;
  }
  return out;
}

/** A display-names object read back from storage, defensively. */
export function normalizeDisplay(raw: unknown): DisplayNames {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_DISPLAY, others: {} };
  const r = raw as Record<string, unknown>;
  const name = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const others: Record<string, string> = {};
  if (typeof r.others === "object" && r.others !== null) {
    for (const [k, v] of Object.entries(r.others as Record<string, unknown>)) {
      const n = name(v);
      if (OTHER_LABEL.test(k) && n) others[k] = n;
    }
  }
  return { a: name(r.a), b: name(r.b), others };
}

/** The public "name map" a share page restores with: display name ->
 * label, nulls dropped. */
export function publicNameMap(display: DisplayNames | null | undefined): NameMapping[] {
  if (!display) return [];
  const out: NameMapping[] = [];
  if (display.a) out.push({ original: display.a, replacement: "Party A" });
  if (display.b) out.push({ original: display.b, replacement: "Party B" });
  for (const [label, name] of Object.entries(display.others)) {
    if (OTHER_LABEL.test(label) && name) out.push({ original: name, replacement: label });
  }
  return out;
}

/** A generous guard against a corrupted or hostile name map. */
const MAX_NAME_ENTRIES = 60;

function isMapping(v: unknown): v is NameMapping {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return typeof m.original === "string" && typeof m.replacement === "string" && m.original.length > 0;
}

/** Earlier entries first, then new ones; exact duplicates dropped (a
 * party's side, then their appeal). */
export function mergeNameMaps(prev: readonly NameMapping[], next: readonly NameMapping[]): NameMapping[] {
  const seen = new Set<string>();
  const out: NameMapping[] = [];
  for (const m of [...prev, ...next]) {
    if (!isMapping(m)) continue;
    const key = `${m.original}\u0000${m.replacement}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ original: m.original, replacement: m.replacement });
    if (out.length >= MAX_NAME_ENTRIES) break;
  }
  return out;
}

/** The labels a verdict and its name map mention besides A and B, for the
 * display editor ("Person C".."Person Z"), in letter order. */
export function otherLabels(nameMap: readonly NameMapping[], display?: DisplayNames | null): string[] {
  const found = new Set<string>();
  for (const m of nameMap) {
    const label = canonicalLabel(m.replacement);
    if (label && OTHER_LABEL.test(label)) found.add(label);
  }
  for (const k of Object.keys(display?.others ?? {})) if (OTHER_LABEL.test(k)) found.add(k);
  return [...found].sort();
}

// --- Response shapes -------------------------------------------------------------

/** GET /api/v1/verdicts/{id}/mine */
export type MineResponse = {
  id: string;
  kind: "free" | "premium" | "case" | "legacy";
  createdAt: string;
  result: VerdictResult | null;
  original: OriginalPayload | null;
  originalStatus: OriginalStatus;
  nameMap: NameMapping[];
  display: DisplayState;
  suggested: { a: string | null };
  removed: { at: string; reason: RemovalReason | null } | null;
  case: { id: string; party: "a" | "b" } | null;
  via: "session" | "token";
  /** The writer has saved the share-page names (or switched them off)
   * before: clients do not prompt for them again before a share. */
  namesConfirmed: boolean;
};

/** PATCH /api/v1/verdicts/{id}/display */
export type DisplayResponse = { display: DisplayState; namesConfirmed: true };

/** POST /api/v1/verdicts/{id}/removal */
export type RemovalResponse = { removed: true; removedAt: string };

/** GET /api/v1/me/verdicts */
export type OwnerVerdictSummary = {
  id: string;
  kind: "free" | "premium";
  createdAt: string;
  verdict: VerdictResult["verdict"] | null;
  headline: string | null;
  nameMap: NameMapping[];
  removed: boolean;
};
export type OwnerVerdictListResponse = { verdicts: OwnerVerdictSummary[]; next: string | null };

/** GET /api/v1/cases/{id}/originals and /respond/{token}/originals */
export type CaseOriginalEntry = { status: OriginalStatus; original: OriginalPayload | null };
export type CaseOriginalsResponse = { party: "a" | "b"; side: CaseOriginalEntry; appeal: CaseOriginalEntry | null };
