/**
 * Write paths for originals: a one-sided verdict saved together with its
 * ownership row and sealed original, and the statements case writes add to
 * their own guarded batches. Server only.
 *
 * Without a usable key nothing personal is written (no original, no display
 * names) and everything else works as before. A failing ownership write
 * never costs the user their verdict: it falls back to the plain save.
 */

import type { InStatement } from "@libsql/client";
import { saveVerdict } from "@/lib/db";
import { entitlementWriteBatch, type StatementGuard } from "@/lib/entitlements";
import type { Lang } from "@/lib/i18n";
import {
  EMPTY_DISPLAY,
  defaultDisplay,
  type DisplayNames,
  type DisplayState,
  type OriginalPayload,
} from "@/lib/originals-types";
import type { FrameworkChoice, VerdictResult } from "@/lib/types";
import { aad, newOwnerToken, ownerTokenHash, sealJson } from "./crypto";
import { ensureOriginalsTables, subjects } from "./db";

/** Seals an original for its subject, or logs that it was skipped (no key). */
export function sealOriginal(subject: string, payload: OriginalPayload): { sealed: string; kid: string } | null {
  const sealed = sealJson(payload, aad.original(subject));
  if (!sealed) console.warn(`[originals] not stored subject=${subject} reason=no_key`);
  return sealed;
}

/** A case party's sealed display name, or null for none (or no key). */
export function sealCaseDisplay(caseId: string, party: "a" | "b", name: string | null | undefined): { sealed: string; kid: string } | null {
  if (!name) return null;
  const sealed = sealJson({ v: 1, name }, aad.caseDisplay(caseId, party));
  if (!sealed) console.warn(`[originals] not stored subject=case:${caseId}:display:${party} reason=no_key`);
  return sealed;
}

/** INSERT of a case side or appeal original, guarded like the write it
 * belongs to. Appeals overwrite a failed attempt's original (one appeal per
 * party per case), unless it was removed. */
export function caseOriginalStatement(
  caseId: string,
  party: "a" | "b",
  kind: "side" | "appeal",
  payload: OriginalPayload,
  guard: StatementGuard,
  nowIso: string,
): InStatement | null {
  const subject = kind === "side" ? subjects.side(caseId, party) : subjects.appeal(caseId, party);
  const sealed = sealOriginal(subject, payload);
  if (!sealed) return null;
  const conflict =
    kind === "side"
      ? "ON CONFLICT(subject) DO NOTHING"
      : `ON CONFLICT(subject) DO UPDATE SET sealed = excluded.sealed, key_id = excluded.key_id, updated_at = excluded.updated_at
         WHERE originals.removed_at IS NULL`;
  return {
    sql: `INSERT INTO originals (subject, kind, verdict_id, case_id, party, sealed, key_id, removed_at, created_at, updated_at)
          SELECT ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ? WHERE ${guard.sql}
          ${conflict}`,
    args: [subject, kind, caseId, party, sealed.sealed, sealed.kid, nowIso, nowIso, ...guard.args],
  };
}

export type SaveVerdictInput = {
  id: string;
  input: string;
  framework: FrameworkChoice;
  result: VerdictResult;
  kind: "free" | "premium";
  /** Signed-in writer; null -> an owner token is issued. */
  ownerUserId: string | null;
  /** Always built; sealed only when a key exists. */
  original: OriginalPayload;
};

export type SaveVerdictOutcome = {
  /** Only when ownerUserId is null and the ownership row was written. */
  ownerToken: string | null;
  originalsStored: boolean;
  display: DisplayState;
  metaWritten: boolean;
};

const LABELS_ONLY: DisplayState = { ...EMPTY_DISPLAY, others: {}, namesVisible: true };

/**
 * One batch: the verdict row, its ownership row and (with a key) its sealed
 * original and default display names. If that batch fails, the verdict is
 * saved alone (logged) and the outcome says nothing else was. Throws only
 * when the plain save fails too (the caller answers 503 as before).
 */
export async function saveVerdictWithOriginals(v: SaveVerdictInput): Promise<SaveVerdictOutcome> {
  try {
    await ensureOriginalsTables();
    const nowIso = new Date().toISOString();
    const subject = subjects.verdict(v.id);
    const lang: Lang = v.result.lang ?? "en";
    const original = sealOriginal(subject, v.original);
    const display: DisplayNames = original ? defaultDisplay(v.original.nameMap, lang) : { ...EMPTY_DISPLAY, others: {} };
    const sealedDisplay = original ? sealJson(display, aad.verdictDisplay(v.id)) : null;
    const token = v.ownerUserId ? null : newOwnerToken();
    const stmts: InStatement[] = [
      {
        sql: "INSERT INTO verdicts (id, input, framework, result) VALUES (?, ?, ?, ?)",
        args: [v.id, v.input, JSON.stringify(v.framework), JSON.stringify(v.result)],
      },
      {
        sql: `INSERT INTO verdict_meta
                (verdict_id, kind, owner_user_id, owner_token_hash, case_id, names_visible, display_sealed,
                 display_key_id, removed_at, removal_reason, created_at, updated_at)
              VALUES (?, ?, ?, ?, NULL, 1, ?, ?, NULL, NULL, ?, ?)`,
        args: [
          v.id,
          v.kind,
          v.ownerUserId,
          token ? ownerTokenHash(token) : null,
          sealedDisplay?.sealed ?? null,
          sealedDisplay?.kid ?? null,
          nowIso,
          nowIso,
        ],
      },
    ];
    if (original) {
      stmts.push({
        sql: `INSERT INTO originals (subject, kind, verdict_id, case_id, party, sealed, key_id, removed_at, created_at, updated_at)
              VALUES (?, 'verdict', ?, NULL, NULL, ?, ?, NULL, ?, ?)`,
        args: [subject, v.id, original.sealed, original.kid, nowIso, nowIso],
      });
    }
    await entitlementWriteBatch(stmts);
    return {
      ownerToken: token,
      originalsStored: Boolean(original),
      display: sealedDisplay ? { ...display, namesVisible: true } : LABELS_ONLY,
      metaWritten: true,
    };
  } catch (e) {
    console.error("[originals] meta write failed:", e instanceof Error ? e.message : String(e));
  }
  await saveVerdict({ id: v.id, input: v.input, framework: v.framework, result: v.result });
  return { ownerToken: null, originalsStored: false, display: LABELS_ONLY, metaWritten: false };
}
