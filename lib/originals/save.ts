/**
 * Write paths for originals: a one-sided verdict saved together with its
 * ownership row and sealed original, and the statements case writes add to
 * their own guarded batches. Server only.
 *
 * Without a usable key nothing personal is written (no original, no display
 * names) and everything else works as before. A failing ownership write
 * never costs the user their verdict: it falls back to the plain save.
 */

import type { InStatement, InValue } from "@libsql/client";
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

/** INSERT ... VALUES, or INSERT ... SELECT ... WHERE <guard> when guarded. */
function insert(head: string, values: InValue[], guard?: StatementGuard): InStatement {
  const marks = values.map(() => "?").join(", ");
  return guard
    ? { sql: `${head} SELECT ${marks} WHERE ${guard.sql}`, args: [...values, ...guard.args] }
    : { sql: `${head} VALUES (${marks})`, args: values };
}

/** The verdict row alone (the fallback when the full batch fails). */
export function plainVerdictStatement(
  v: Pick<SaveVerdictInput, "id" | "input" | "framework" | "result">,
  guard?: StatementGuard,
): InStatement {
  return insert(
    "INSERT INTO verdicts (id, input, framework, result)",
    [v.id, v.input, JSON.stringify(v.framework), JSON.stringify(v.result)],
    guard,
  );
}

/**
 * The statements of one save: the verdict row, its ownership row and (with
 * a key) its sealed original and default display names, plus the outcome
 * the caller reports once they ran. `ownerToken` is a token the caller
 * already handed out (async verdicts); otherwise one is made for a
 * signed-out writer. With `guard`, every insert is skipped unless it holds
 * (an async verdict's job is still judging). Needs ensureOriginalsTables.
 */
export function verdictWriteStatements(
  v: SaveVerdictInput,
  opts: { ownerToken?: string | null; guard?: StatementGuard } = {},
): { stmts: InStatement[]; outcome: SaveVerdictOutcome } {
  const { guard } = opts;
  const nowIso = new Date().toISOString();
  const subject = subjects.verdict(v.id);
  const lang: Lang = v.result.lang ?? "en";
  const original = sealOriginal(subject, v.original);
  const display: DisplayNames = original ? defaultDisplay(v.original.nameMap, lang) : { ...EMPTY_DISPLAY, others: {} };
  const sealedDisplay = original ? sealJson(display, aad.verdictDisplay(v.id)) : null;
  const token = v.ownerUserId ? null : (opts.ownerToken ?? newOwnerToken());
  const stmts: InStatement[] = [
    plainVerdictStatement(v, guard),
    insert(
      `INSERT INTO verdict_meta
         (verdict_id, kind, owner_user_id, owner_token_hash, case_id, names_visible, display_sealed,
          display_key_id, removed_at, removal_reason, created_at, updated_at)`,
      [
        v.id,
        v.kind,
        v.ownerUserId,
        token ? ownerTokenHash(token) : null,
        null,
        1,
        sealedDisplay?.sealed ?? null,
        sealedDisplay?.kid ?? null,
        null,
        null,
        nowIso,
        nowIso,
      ],
      guard,
    ),
  ];
  if (original) {
    stmts.push(
      insert(
        "INSERT INTO originals (subject, kind, verdict_id, case_id, party, sealed, key_id, removed_at, created_at, updated_at)",
        [subject, "verdict", v.id, null, null, original.sealed, original.kid, null, nowIso, nowIso],
        guard,
      ),
    );
  }
  return {
    stmts,
    outcome: {
      ownerToken: token,
      originalsStored: Boolean(original),
      display: sealedDisplay ? { ...display, namesVisible: true } : LABELS_ONLY,
      metaWritten: true,
    },
  };
}

/** What a save reports when only the verdict row was written. */
export const PLAIN_SAVE_OUTCOME: SaveVerdictOutcome = {
  ownerToken: null,
  originalsStored: false,
  display: LABELS_ONLY,
  metaWritten: false,
};

/**
 * One batch: the verdict row, its ownership row and (with a key) its sealed
 * original and default display names. If that batch fails, the verdict is
 * saved alone (logged) and the outcome says nothing else was. Throws only
 * when the plain save fails too (the caller answers 503 as before).
 */
export async function saveVerdictWithOriginals(v: SaveVerdictInput): Promise<SaveVerdictOutcome> {
  try {
    await ensureOriginalsTables();
    const { stmts, outcome } = verdictWriteStatements(v);
    await entitlementWriteBatch(stmts);
    return outcome;
  } catch (e) {
    console.error("[originals] meta write failed:", e instanceof Error ? e.message : String(e));
  }
  await saveVerdict({ id: v.id, input: v.input, framework: v.framework, result: v.result });
  return { ...PLAIN_SAVE_OUTCOME };
}
