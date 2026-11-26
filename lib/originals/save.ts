/**
 * Write paths for originals: a one-sided verdict saved together with its
 * ownership row and sealed original, and the statements case writes add to
 * their own guarded batches. Server only.
 *
 * Without a usable key nothing personal is written (no original, no display
 * names) and everything else works as before. A failing ownership write
 * never costs the user their verdict: it falls back to the plain save.
 */

import type { PartyLetter as CaseParty } from "@/lib/case-types";
import type { InStatement, InValue } from "@libsql/client";
import { teenSql } from "@/lib/age";
import { saveVerdict, STORED_FRAMEWORK } from "@/lib/db";
import { entitlementWriteBatch, type StatementGuard } from "@/lib/entitlements";
import { oneSidedStampStatement } from "@/lib/feedback/db";
import type { Lang } from "@/lib/i18n";
import {
  EMPTY_DISPLAY,
  defaultDisplay,
  type DisplayNames,
  type DisplayState,
  type OriginalPayload,
} from "@/lib/originals-types";
import { POLICY_VERSION } from "@/lib/policy";
import type { VerdictResult } from "@/lib/types";
import type { Venue } from "@/lib/venues";
import { aad, newOwnerToken, ownerTokenHash, sealJson } from "./crypto";
import { ensureOriginalsTables, subjects } from "./db";

/** Seals an original for its subject, or logs that it was skipped (no key). */
export function sealOriginal(subject: string, payload: OriginalPayload): { sealed: string; kid: string } | null {
  const sealed = sealJson(payload, aad.original(subject));
  if (!sealed) console.warn(`[originals] not stored subject=${subject} reason=no_key`);
  return sealed;
}

/** A case party's sealed display name, or null for none (or no key). */
export function sealCaseDisplay(caseId: string, party: CaseParty, name: string | null | undefined): { sealed: string; kid: string } | null {
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
  party: CaseParty,
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
  result: VerdictResult;
  kind: "free" | "premium";
  /** Signed-in writer; null -> an owner token is issued. */
  ownerUserId: string | null;
  /** The writer is under 18: names stay off the share page until they say otherwise. */
  teen?: boolean;
  /** Always built; sealed only when a key exists. */
  original: OriginalPayload;
  /** The scene the court is set in. */
  venue?: Venue | null;
};

export type SaveVerdictOutcome = {
  /** Only when ownerUserId is null and the ownership row was written. */
  ownerToken: string | null;
  originalsStored: boolean;
  display: DisplayState;
  metaWritten: boolean;
};

const LABELS_ONLY: DisplayState = { ...EMPTY_DISPLAY, others: {}, namesVisible: true };

/** A value computed by the statement itself. */
type Expr = { sql: string; args: InValue[] };

/** INSERT ... VALUES, or INSERT ... SELECT ... WHERE <guard> when guarded. */
function insert(head: string, values: (InValue | Expr)[], guard?: StatementGuard): InStatement {
  const isExpr = (v: InValue | Expr): v is Expr => typeof v === "object" && v !== null && "sql" in v;
  const marks = values.map((v) => (isExpr(v) ? v.sql : "?")).join(", ");
  const args = values.flatMap((v) => (isExpr(v) ? v.args : [v]));
  return guard
    ? { sql: `${head} SELECT ${marks} WHERE ${guard.sql}`, args: [...args, ...guard.args] }
    : { sql: `${head} VALUES (${marks})`, args };
}

/** 0 when the writer is a teen, decided in the statement itself so a teen
 * recorded while the verdict was judging still gets names off. */
function namesDefault(v: Pick<SaveVerdictInput, "teen" | "ownerUserId">): InValue | Expr {
  if (v.teen) return 0;
  if (!v.ownerUserId) return 1;
  return {
    sql: `CASE WHEN EXISTS (SELECT 1 FROM "user" tu WHERE tu.id = ? AND ${teenSql("tu")}) THEN 0 ELSE 1 END`,
    args: [v.ownerUserId],
  };
}

/** The verdict row alone (the fallback when the full batch fails). */
export function plainVerdictStatement(
  v: Pick<SaveVerdictInput, "id" | "input" | "result" | "venue">,
  guard?: StatementGuard,
): InStatement {
  return insert(
    "INSERT INTO verdicts (id, input, framework, result, venue)",
    [v.id, v.input, STORED_FRAMEWORK, JSON.stringify(v.result), v.venue ?? null],
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
  const display: DisplayNames = original ? defaultDisplay(v.original.nameMap, lang, v.result.parties?.length ?? 2) : { ...EMPTY_DISPLAY, others: {} };
  const sealedDisplay = original ? sealJson(display, aad.verdictDisplay(v.id)) : null;
  const token = v.ownerUserId ? null : (opts.ownerToken ?? newOwnerToken());
  const stmts: InStatement[] = [
    plainVerdictStatement(v, guard),
    insert(
      `INSERT INTO verdict_meta
         (verdict_id, kind, owner_user_id, owner_token_hash, case_id, names_visible, display_sealed,
          display_key_id, removed_at, removal_reason, created_at, updated_at, policy_version, lang, sides)`,
      [
        v.id,
        v.kind,
        v.ownerUserId,
        token ? ownerTokenHash(token) : null,
        null,
        namesDefault(v),
        sealedDisplay?.sealed ?? null,
        sealedDisplay?.kid ?? null,
        null,
        null,
        nowIso,
        nowIso,
        POLICY_VERSION,
        lang,
        v.result.parties?.length ?? 2,
      ],
      guard,
    ),
  ];
  if (v.ownerUserId) stmts.push(oneSidedStampStatement(v.id, v.ownerUserId, nowIso));
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
      display: sealedDisplay ? { ...display, namesVisible: !v.teen } : { ...LABELS_ONLY, namesVisible: !v.teen },
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

/** PLAIN_SAVE_OUTCOME for this verdict: a teen's names stay off. */
export function plainSaveOutcome(v: Pick<SaveVerdictInput, "teen">): SaveVerdictOutcome {
  return { ...PLAIN_SAVE_OUTCOME, display: { ...PLAIN_SAVE_OUTCOME.display, namesVisible: !v.teen } };
}

/**
 * One batch: the verdict row, its ownership row and (with a key) its sealed
 * original and default display names. If that batch fails, the verdict is
 * saved alone (logged) and the outcome says nothing else was. Throws only
 * when the plain save fails too (the caller answers 503 as before).
 * `settle` (the reservation's consume) goes in the same batch, so a stored
 * verdict is never left with its unit unspent.
 */
export async function saveVerdictWithOriginals(v: SaveVerdictInput, settle: InStatement[] = []): Promise<SaveVerdictOutcome> {
  try {
    await ensureOriginalsTables();
    const { stmts, outcome } = verdictWriteStatements(v);
    await entitlementWriteBatch([...stmts, ...settle]);
    return outcome;
  } catch (e) {
    console.error("[originals] meta write failed:", e instanceof Error ? e.message : String(e));
  }
  if (settle.length > 0) await entitlementWriteBatch([plainVerdictStatement(v), ...settle]);
  else await saveVerdict({ id: v.id, input: v.input, result: v.result, venue: v.venue });
  return plainSaveOutcome(v);
}
