/**
 * Case operations without HTTP: create, answer, judge now, rotate the
 * invite, delete, appeal, account deletion. Gates (session, origin, limits)
 * are the caller's; these functions own state checks, credits and writes.
 *
 * Every multi-row write is one guarded batch through entitlementWriteBatch.
 * A statement that must only apply if an earlier one did is guarded with
 * EXISTS on a fresh token (judging_token / attempt_token) or a fresh id.
 * Each submission is anonymized once, when it is submitted; only the
 * anonymized text and keyed name fingerprints are written.
 */

import { nanoid } from "nanoid";
import type { InStatement } from "@libsql/client";
import { CASE_EXPIRY_DAYS, type PartyLetter } from "@/lib/case-types";
import type { PremiumBlock } from "@/lib/account-types";
import {
  entitlementWriteBatch,
  holdStatement,
  refundPremiumVerdict,
  refundStatements,
  reservationByKey,
  reservePremiumVerdict,
  type StatementGuard,
} from "@/lib/entitlements";
import {
  anonymizeSubmission,
  caseNameKeys,
  type AnonymizedSubmission,
  type KnownPerson,
  type VerifiedEvidence,
} from "@/lib/evidence";
import type { Lang } from "@/lib/i18n";
import type { FrameworkChoice, NameMapping } from "@/lib/types";
import { composeForJudging } from "./compose";
import {
  caseDb,
  ensureCaseTables,
  getAppeal,
  getCase,
  getCaseByOwnerKey,
  loadCaseBundle,
  type CaseBundle,
  type CaseRow,
} from "./db";
import { claimMatches, inviteHash, inviteToken, newInviteNonce, respondentClaim } from "./invite";
import { meteredStep, runAppealJudging, runCaseJudging } from "./judging";
import { scheduleJudging } from "./schedule";
import { effectiveStatus, expireStatements, materializeExpiry } from "./sweep";

const DAY_MS = 24 * 60 * 60 * 1000;

export type Blocked = { ok: false; code: PremiumBlock; resetsAt?: string };
export type Failure<C extends string> = { ok: false; code: C };

const LABEL: Record<PartyLetter, "Party A" | "Party B"> = { a: "Party A", b: "Party B" };

function logError(what: string, e: unknown): void {
  console.error(`[cases] ${what}:`, e instanceof Error ? e.message : String(e));
}

async function refundQuietly(reservationId: string): Promise<void> {
  try {
    await refundPremiumVerdict(reservationId);
  } catch (e) {
    logError("refund failed", e);
  }
}

/** Rows that persist one anonymized submission (side or appeal), each
 * guarded so nothing is written unless the state change it belongs to was. */
function submissionStatements(
  caseId: string,
  party: PartyLetter,
  sub: AnonymizedSubmission,
  guard: StatementGuard,
  nowIso: string,
  appeal: { idSql: string; idArgs: (string | null)[] } | null,
): InStatement[] {
  const stmts: InStatement[] = [];
  if (!appeal) {
    stmts.push({
      sql: `INSERT INTO case_sides (case_id, party, text, submitted_at)
            SELECT ?, ?, ?, ? WHERE ${guard.sql}
            ON CONFLICT DO NOTHING`,
      args: [caseId, party, sub.text, nowIso, ...guard.args],
    });
  }
  sub.evidence.forEach((item, i) => {
    stmts.push({
      sql: `INSERT INTO case_evidence (id, case_id, party, appeal_id, seq, kind, transcript, created_at)
            SELECT ?, ?, ?, ${appeal ? appeal.idSql : "NULL"}, ?, ?, ?, ? WHERE ${guard.sql}`,
      args: [
        nanoid(12),
        caseId,
        party,
        ...(appeal ? appeal.idArgs : []),
        i + 1,
        item.kind,
        item.transcript,
        nowIso,
        ...guard.args,
      ],
    });
  });
  for (const person of sub.people) {
    stmts.push({
      sql: `INSERT INTO case_people (case_id, name_key, label)
            SELECT ?, ?, ? WHERE ${guard.sql}
            ON CONFLICT DO NOTHING`,
      args: [caseId, person.key, person.label, ...guard.args],
    });
  }
  return stmts;
}

/** Labels already used in a case: the parties, known fingerprints, and any
 * "Person X" in the anonymized material. */
function labelsInUse(context: string, people: readonly KnownPerson[]): string[] {
  const found = new Set<string>(["Party A", "Party B", ...people.map((p) => p.label)]);
  for (const m of context.matchAll(/(?<![\p{L}])(Person [C-Z])(?![\p{L}\p{N}])/gu)) found.add(m[1]);
  return [...found];
}

function rosterContext(bundle: CaseBundle): string {
  const mode = bundle.row.mode ?? (bundle.sides.some((s) => s.party === "b") ? "two_sided" : "one_sided");
  const earlier = bundle.appeals.filter((a) => a.status === "judged");
  const doc = composeForJudging(bundle.sides, mode, { earlier, current: null });
  const transcripts = bundle.evidence.map((e) => e.transcript).join("\n\n");
  return transcripts ? `${doc}\n\n${transcripts}` : doc;
}

// --- Create -----------------------------------------------------------------------

export type CreateCaseInput = {
  ownerId: string;
  text: string;
  framework: FrameworkChoice;
  lang: Lang;
  evidence: VerifiedEvidence[];
  idempotencyKey?: string;
  now?: Date;
};

export type CreateCaseResult =
  | { ok: true; row: CaseRow; nameMap: NameMapping[]; replayed: boolean }
  | Blocked
  | Failure<"unavailable" | "in_progress">;

export async function createCase(input: CreateCaseInput): Promise<CreateCaseResult> {
  await ensureCaseTables();
  const now = input.now ?? new Date();
  const key = input.idempotencyKey || null;
  if (key) {
    const existing = await getCaseByOwnerKey(input.ownerId, key);
    if (existing) return { ok: true, row: existing, nameMap: [], replayed: true };
  }

  const reserved = await reservePremiumVerdict(input.ownerId, { now });
  if (!reserved.ok) {
    if (reserved.code === "premium_required" || reserved.code === "no_credits" || reserved.code === "fair_use") {
      return { ok: false, code: reserved.code, ...("resetsAt" in reserved && reserved.resetsAt ? { resetsAt: reserved.resetsAt } : {}) };
    }
    return { ok: false, code: "unavailable" };
  }
  const reservationId = reserved.reservation.id;

  const caseId = nanoid(12);
  const nonce = newInviteNonce();
  const token = inviteToken(caseId, nonce);
  if (!token) {
    await refundQuietly(reservationId);
    return { ok: false, code: "unavailable" };
  }

  let sub: AnonymizedSubmission;
  try {
    sub = await meteredStep(caseId, "anonymize_a", () =>
      anonymizeSubmission({
        narrator: "Party A",
        text: input.text,
        evidence: input.evidence,
        lang: input.lang,
        twoSided: true,
        names: { keysFor: caseNameKeys(caseId), known: [] },
      }),
    );
  } catch (e) {
    logError("anonymizing side A failed", e);
    await refundQuietly(reservationId);
    return { ok: false, code: "unavailable" };
  }

  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + CASE_EXPIRY_DAYS * DAY_MS).toISOString();
  const guard: StatementGuard = { sql: "EXISTS (SELECT 1 FROM cases WHERE id = ?)", args: [caseId] };
  let inserted = false;
  try {
    const rs = await entitlementWriteBatch([
      {
        sql: `INSERT INTO cases
                (id, owner_id, status, mode, framework, lang, invite_nonce, invite_hash, idempotency_key,
                 reservation_id, expires_at, created_at, updated_at)
              VALUES (?, ?, 'awaiting_respondent', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT DO NOTHING`,
        args: [
          caseId,
          input.ownerId,
          JSON.stringify(input.framework),
          input.lang,
          nonce,
          inviteHash(token),
          key,
          reservationId,
          expiresAt,
          nowIso,
          nowIso,
        ],
      },
      ...submissionStatements(caseId, "a", sub, guard, nowIso, null),
      // The unit stays held until the invite expires (then the usual
      // 10-minute stale rule applies).
      holdStatement(reservationId, expiresAt, guard),
    ]);
    inserted = rs[0].rowsAffected === 1;
  } catch (e) {
    logError("creating the case failed", e);
    await refundQuietly(reservationId);
    return { ok: false, code: "unavailable" };
  }

  if (!inserted) {
    // A concurrent request with the same Idempotency-Key won.
    await refundQuietly(reservationId);
    const existing = key ? await getCaseByOwnerKey(input.ownerId, key) : null;
    return existing ? { ok: true, row: existing, nameMap: [], replayed: true } : { ok: false, code: "in_progress" };
  }
  const row = await getCase(caseId);
  if (!row) return { ok: false, code: "unavailable" };
  return { ok: true, row, nameMap: sub.nameMap, replayed: false };
}

// --- Respondent answer --------------------------------------------------------------

export type RespondInput = {
  row: CaseRow;
  /** The signed-in account answering, bound as Party B; null when signed out. */
  userId: string | null;
  text: string;
  evidence: VerifiedEvidence[];
  idempotencyKey?: string;
  origin: string;
  now?: Date;
};

export type RespondResult =
  | { ok: true; row: CaseRow; nameMap: NameMapping[]; claim: string | null; replayed: boolean }
  | Failure<"case_expired" | "case_closed" | "unavailable">;

/** The claim secret for whoever answered signed out (null once an account
 * is bound to side B, or when side B predates claims). */
export function claimFor(row: CaseRow): string | null {
  if (row.respondentUserId || !row.respondentClaimNonce) return null;
  return respondentClaim(row.id, row.respondentClaimNonce);
}

function closedOrReplay(row: CaseRow, key: string | null, now: Date): RespondResult {
  if (key && row.respondentIdem === key) return { ok: true, row, nameMap: [], claim: claimFor(row), replayed: true };
  return { ok: false, code: effectiveStatus(row, now) === "expired" ? "case_expired" : "case_closed" };
}

export async function respondToCase(input: RespondInput): Promise<RespondResult> {
  const startedAt = Date.now();
  const now = input.now ?? new Date();
  const key = input.idempotencyKey || null;
  const row = input.row;
  const status = effectiveStatus(row, now);
  if (status === "expired") {
    await materializeExpiry(row, now).catch((e: unknown) => logError("expiry failed", e));
    return { ok: false, code: "case_expired" };
  }
  if (status !== "awaiting_respondent") return closedOrReplay(row, key, now);

  const bundle = await loadCaseBundle(row);
  const context = rosterContext(bundle);
  let sub: AnonymizedSubmission;
  try {
    sub = await meteredStep(row.id, "anonymize_b", () =>
      anonymizeSubmission({
        narrator: "Party B",
        text: input.text,
        evidence: input.evidence,
        lang: row.lang,
        twoSided: true,
        roster: { context, labelsInUse: labelsInUse(context, bundle.people) },
        names: { keysFor: caseNameKeys(row.id), known: bundle.people },
      }),
    );
  } catch (e) {
    logError("anonymizing side B failed", e);
    return { ok: false, code: "unavailable" };
  }

  const nowIso = now.toISOString();
  const token = nanoid(16);
  const guard: StatementGuard = {
    sql: "EXISTS (SELECT 1 FROM cases WHERE id = ? AND judging_token = ?)",
    args: [row.id, token],
  };
  // Side B's author: the signed-in account, else whoever holds the claim
  // secret derived from this nonce (returned in this response).
  const claimNonce = newInviteNonce();
  let won = false;
  try {
    const rs = await entitlementWriteBatch([
      {
        sql: `UPDATE cases SET status = 'judging', mode = 'two_sided', judging_token = ?, judging_started_at = ?,
                respondent_idem = ?, respondent_user_id = ?, respondent_claim_nonce = ?,
                attempts = attempts + 1, last_error = NULL, updated_at = ?
              WHERE id = ? AND status = 'awaiting_respondent' AND expires_at > ?`,
        args: [token, nowIso, key, input.userId, claimNonce, nowIso, row.id, nowIso],
      },
      ...submissionStatements(row.id, "b", sub, guard, nowIso, null),
      // Judging starts now: the held unit gets the usual 10-minute crash clock.
      ...(row.reservationId ? [holdStatement(row.reservationId, nowIso, guard)] : []),
    ]);
    won = rs[0].rowsAffected === 1;
  } catch (e) {
    logError("storing the answer failed", e);
    return { ok: false, code: "unavailable" };
  }
  const fresh = (await getCase(row.id)) ?? row;
  if (!won) return closedOrReplay(fresh, key, now);
  scheduleJudging(() => runCaseJudging(row.id, token, input.origin, startedAt));
  return { ok: true, row: fresh, nameMap: sub.nameMap, claim: claimFor(fresh), replayed: false };
}

// --- Judge now / retry -------------------------------------------------------------

export type JudgeNowResult =
  | { ok: true; row: CaseRow; started: boolean }
  | Blocked
  | Failure<"invalid" | "case_closed" | "unavailable">;

/**
 * awaiting + only_mine: judge side A alone with the held unit (the invite
 * closes). expired: a new unit, one-sided. failed: a new unit, same mode.
 * Already judging or judged: no-op (idempotent).
 */
export async function judgeNow(input: {
  row: CaseRow;
  mode?: "only_mine";
  origin: string;
  now?: Date;
}): Promise<JudgeNowResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  let row = input.row;
  for (let attempt = 0; attempt < 2; attempt++) {
    const status = effectiveStatus(row, now);
    if (status === "judging" || status === "judged") return { ok: true, row, started: false };

    if (status === "awaiting_respondent") {
      if (input.mode !== "only_mine") return { ok: false, code: "invalid" };
      const token = nanoid(16);
      const guard: StatementGuard = {
        sql: "EXISTS (SELECT 1 FROM cases WHERE id = ? AND judging_token = ?)",
        args: [row.id, token],
      };
      const rs = await entitlementWriteBatch([
        {
          sql: `UPDATE cases SET status = 'judging', mode = 'one_sided', judging_token = ?, judging_started_at = ?,
                  attempts = attempts + 1, last_error = NULL, updated_at = ?
                WHERE id = ? AND status = 'awaiting_respondent' AND expires_at > ?`,
          args: [token, nowIso, nowIso, row.id, nowIso],
        },
        ...(row.reservationId ? [holdStatement(row.reservationId, nowIso, guard)] : []),
      ]);
      if (rs[0].rowsAffected === 1) {
        scheduleJudging(() => runCaseJudging(row.id, token, input.origin));
        return { ok: true, row: (await getCase(row.id)) ?? row, started: true };
      }
      // The respondent answered first, or the invite just expired.
      row = (await getCase(row.id)) ?? row;
      continue;
    }

    // expired or failed: a fresh unit funds the run.
    if (status === "expired") await materializeExpiry(row, now);
    const reserved = await reservePremiumVerdict(row.ownerId, { now });
    if (!reserved.ok) {
      if (reserved.code === "premium_required" || reserved.code === "no_credits" || reserved.code === "fair_use") {
        return { ok: false, code: reserved.code, ...("resetsAt" in reserved && reserved.resetsAt ? { resetsAt: reserved.resetsAt } : {}) };
      }
      return { ok: false, code: "unavailable" };
    }
    const reservationId = reserved.reservation.id;
    const token = nanoid(16);
    const from = status === "expired" ? "expired" : "failed";
    let won = false;
    try {
      const rs = await entitlementWriteBatch([
        {
          sql: `UPDATE cases SET status = 'judging', mode = ${from === "expired" ? "'one_sided'" : "COALESCE(mode, 'one_sided')"},
                  reservation_id = ?, judging_token = ?, judging_started_at = ?, attempts = attempts + 1,
                  last_error = NULL, updated_at = ?
                WHERE id = ? AND status = ?`,
          args: [reservationId, token, nowIso, nowIso, row.id, from],
        },
      ]);
      won = rs[0].rowsAffected === 1;
    } catch (e) {
      logError("starting a judging run failed", e);
    }
    if (!won) {
      await refundQuietly(reservationId);
      const fresh = (await getCase(row.id)) ?? row;
      const s = effectiveStatus(fresh, now);
      if (s === "judging" || s === "judged") return { ok: true, row: fresh, started: false };
      return { ok: false, code: "unavailable" };
    }
    scheduleJudging(() => runCaseJudging(row.id, token, input.origin));
    return { ok: true, row: (await getCase(row.id)) ?? row, started: true };
  }
  return { ok: false, code: "case_closed" };
}

// --- Invite --------------------------------------------------------------------------

export type RotateResult = { ok: true; row: CaseRow; token: string } | Failure<"case_closed" | "unavailable">;

export async function rotateInvite(row: CaseRow, now: Date = new Date()): Promise<RotateResult> {
  if (effectiveStatus(row, now) !== "awaiting_respondent") return { ok: false, code: "case_closed" };
  const nonce = newInviteNonce();
  const token = inviteToken(row.id, nonce);
  if (!token) return { ok: false, code: "unavailable" };
  const nowIso = now.toISOString();
  const rs = await entitlementWriteBatch([
    {
      sql: `UPDATE cases SET invite_nonce = ?, invite_hash = ?, updated_at = ?
            WHERE id = ? AND status = 'awaiting_respondent' AND expires_at > ?`,
      args: [nonce, inviteHash(token), nowIso, row.id, nowIso],
    },
  ]);
  if (rs[0].rowsAffected !== 1) return { ok: false, code: "case_closed" };
  return { ok: true, row: (await getCase(row.id)) ?? row, token };
}

/** The owner's current invite token, healing invite_hash when the derived
 * token changed (the secret was rotated; the old link was dead anyway). */
export async function currentInviteToken(row: CaseRow): Promise<string | null> {
  const token = inviteToken(row.id, row.inviteNonce);
  if (!token) return null;
  const hash = inviteHash(token);
  if (hash !== row.inviteHash && row.status === "awaiting_respondent") {
    try {
      await entitlementWriteBatch([
        { sql: "UPDATE cases SET invite_hash = ? WHERE id = ? AND invite_nonce = ?", args: [hash, row.id, row.inviteNonce] },
      ]);
    } catch (e) {
      logError("updating the invite hash failed", e);
    }
  }
  return token;
}

// --- Delete --------------------------------------------------------------------------

/** Deletes every row of the cases selected by `where` (on table alias-free
 * `cases` columns), verdicts and their translations included. */
function deleteStatements(where: string, args: (string | null)[], guard: string): InStatement[] {
  const ids = `SELECT id FROM cases WHERE ${where}${guard}`;
  const verdictIds = `SELECT verdict_id FROM case_verdicts WHERE case_id IN (${ids})`;
  return [
    { sql: `DELETE FROM verdict_translations WHERE id IN (${verdictIds})`, args },
    { sql: `DELETE FROM verdicts WHERE id IN (${verdictIds})`, args },
    { sql: `DELETE FROM case_verdicts WHERE case_id IN (${ids})`, args },
    { sql: `DELETE FROM case_appeals WHERE case_id IN (${ids})`, args },
    { sql: `DELETE FROM case_evidence WHERE case_id IN (${ids})`, args },
    { sql: `DELETE FROM case_people WHERE case_id IN (${ids})`, args },
    { sql: `DELETE FROM case_sides WHERE case_id IN (${ids})`, args },
    { sql: `DELETE FROM cases WHERE ${where}${guard}`, args },
  ];
}

const NOT_BUSY = ` AND status <> 'judging'
  AND NOT EXISTS (SELECT 1 FROM case_appeals a WHERE a.case_id = cases.id AND a.status = 'judging')`;

export type DeleteResult = { ok: true } | Failure<"in_progress" | "not_found">;

/** Deletes one case (refusing while anything is judging) and refunds a held unit. */
export async function deleteCase(row: CaseRow, now: Date = new Date()): Promise<DeleteResult> {
  const bundle = await loadCaseBundle(row);
  if (row.status === "judging" || bundle.appeals.some((a) => a.status === "judging")) {
    return { ok: false, code: "in_progress" };
  }
  const nowIso = now.toISOString();
  const refund = row.reservationId
    ? refundStatements(row.reservationId, nowIso, {
        sql: `EXISTS (SELECT 1 FROM cases WHERE id = ? AND reservation_id = ? AND status IN ('awaiting_respondent','expired')${NOT_BUSY})`,
        args: [row.id, row.reservationId],
      })
    : [];
  const stmts = [...refund, ...deleteStatements("id = ?", [row.id], NOT_BUSY)];
  const rs = await entitlementWriteBatch(stmts);
  if (rs[rs.length - 1].rowsAffected === 1) return { ok: true };
  return (await getCase(row.id)) ? { ok: false, code: "in_progress" } : { ok: false, code: "not_found" };
}

/** Account deletion: every case the user owns (sides, evidence, people,
 * appeals, verdicts, translations), plus their respondent bindings and
 * appeal authorship on other cases. One batch; held units are not refunded
 * (the entitlement rows are deleted right after). */
export async function deleteUserCases(userId: string): Promise<void> {
  await caseDb();
  await entitlementWriteBatch([
    ...deleteStatements("owner_id = ?", [userId], ""),
    {
      sql: "UPDATE cases SET respondent_user_id = NULL, respondent_claim_nonce = NULL WHERE respondent_user_id = ?",
      args: [userId],
    },
    { sql: "UPDATE case_appeals SET user_id = NULL WHERE user_id = ?", args: [userId] },
  ]);
}

// --- Appeals ---------------------------------------------------------------------------

export type AppealInput = {
  row: CaseRow;
  party: PartyLetter;
  userId: string;
  /** Party B only: the claim secret from the answer, needed until an
   * account is bound to side B. */
  claim?: string;
  text: string;
  evidence: VerifiedEvidence[];
  idempotencyKey?: string;
  now?: Date;
};

export type AppealResult =
  | { ok: true; row: CaseRow; nameMap: NameMapping[]; replayed: boolean }
  | Blocked
  | Failure<"case_closed" | "appeal_used" | "in_progress" | "not_party" | "unavailable">;

/** Party B is the account bound when side B was written, or (while none is
 * bound) a signed-in account holding the claim secret; never the owner. */
export function mayActAsRespondent(row: CaseRow, userId: string, claim: string | null | undefined): boolean {
  if (row.mode !== "two_sided" || userId === row.ownerId) return false;
  if (row.respondentUserId) return row.respondentUserId === userId;
  return claimMatches(row, claim);
}

export async function submitAppeal(input: AppealInput): Promise<AppealResult> {
  const startedAt = Date.now();
  const now = input.now ?? new Date();
  const { row, party, userId } = input;
  if (effectiveStatus(row, now) !== "judged") return { ok: false, code: "case_closed" };
  const usageKey = input.idempotencyKey ? `appeal:${row.id}:${input.idempotencyKey}` : undefined;

  if (usageKey) {
    const prior = await reservationByKey(userId, usageKey);
    if (prior && prior.status !== "refunded") return { ok: true, row, nameMap: [], replayed: true };
  }

  const bundle = await loadCaseBundle(row);
  if (bundle.verdicts.length === 0) return { ok: false, code: "case_closed" };
  if (party === "b" ? !mayActAsRespondent(row, userId, input.claim) : userId !== row.ownerId) {
    return { ok: false, code: "not_party" };
  }
  if (bundle.appeals.some((a) => a.party === party && a.status === "judged")) return { ok: false, code: "appeal_used" };
  if (bundle.appeals.some((a) => a.status === "judging")) return { ok: false, code: "in_progress" };

  const reserved = await reservePremiumVerdict(userId, { ...(usageKey ? { idempotencyKey: usageKey } : {}), now });
  if (!reserved.ok) {
    if (reserved.code === "premium_required" || reserved.code === "no_credits" || reserved.code === "fair_use") {
      return { ok: false, code: reserved.code, ...("resetsAt" in reserved && reserved.resetsAt ? { resetsAt: reserved.resetsAt } : {}) };
    }
    if (reserved.code === "replay" || reserved.code === "in_progress") return { ok: true, row, nameMap: [], replayed: true };
    return { ok: false, code: "unavailable" };
  }
  const reservationId = reserved.reservation.id;

  const context = rosterContext(bundle);
  let sub: AnonymizedSubmission;
  try {
    sub = await meteredStep(row.id, `anonymize_appeal_${party}`, () =>
      anonymizeSubmission({
        narrator: LABEL[party],
        text: input.text,
        evidence: input.evidence,
        lang: row.lang,
        twoSided: row.mode === "two_sided",
        roster: { context, labelsInUse: labelsInUse(context, bundle.people) },
        names: { keysFor: caseNameKeys(row.id), known: bundle.people },
      }),
    );
  } catch (e) {
    logError("anonymizing the appeal failed", e);
    await refundQuietly(reservationId);
    return { ok: false, code: "unavailable" };
  }

  const nowIso = now.toISOString();
  const attemptToken = nanoid(16);
  // The verdict this appeal answers is read inside the INSERT: anonymizing
  // can take a while, and the other party's appeal may have been judged
  // meanwhile. The snapshot's latest is only the fallback.
  const snapshotSeq = bundle.verdicts[bundle.verdicts.length - 1].seq;
  const guard: StatementGuard = {
    sql: "EXISTS (SELECT 1 FROM case_appeals WHERE case_id = ? AND party = ? AND attempt_token = ?)",
    args: [row.id, party, attemptToken],
  };
  const appealIdSql = "(SELECT id FROM case_appeals WHERE case_id = ? AND party = ? AND attempt_token = ?)";
  const bindingOk =
    party === "b" ? "AND ((SELECT respondent_user_id FROM cases WHERE id = ?) IS NULL OR (SELECT respondent_user_id FROM cases WHERE id = ?) = ?)" : "";
  let won = false;
  try {
    const rs = await entitlementWriteBatch([
      {
        // New appeal, or a retry of this party's failed one (same id kept).
        sql: `INSERT INTO case_appeals
                (id, case_id, party, user_id, text, status, error, reservation_id, attempt_token, base_seq,
                 result_seq, outcome, created_at, updated_at)
              SELECT ?, ?, ?, ?, ?, 'judging', NULL, ?, ?,
                     COALESCE((SELECT MAX(seq) FROM case_verdicts WHERE case_id = ?), ?), NULL, NULL, ?, ?
              WHERE EXISTS (SELECT 1 FROM cases WHERE id = ? AND status = 'judged')
                AND NOT EXISTS (SELECT 1 FROM case_appeals WHERE case_id = ? AND status = 'judging')
                ${bindingOk}
              ON CONFLICT (case_id, party) DO UPDATE SET
                user_id = excluded.user_id, text = excluded.text, status = 'judging', error = NULL,
                reservation_id = excluded.reservation_id, attempt_token = excluded.attempt_token,
                base_seq = excluded.base_seq, result_seq = NULL, outcome = NULL, updated_at = excluded.updated_at
              WHERE case_appeals.status = 'failed'`,
        args: [
          nanoid(12),
          row.id,
          party,
          userId,
          sub.text,
          reservationId,
          attemptToken,
          row.id,
          snapshotSeq,
          nowIso,
          nowIso,
          row.id,
          row.id,
          ...(party === "b" ? [row.id, row.id, userId] : []),
        ],
      },
      {
        sql: `DELETE FROM case_evidence WHERE appeal_id = ${appealIdSql}`,
        args: [row.id, party, attemptToken],
      },
      ...submissionStatements(row.id, party, sub, guard, nowIso, {
        idSql: appealIdSql,
        idArgs: [row.id, party, attemptToken],
      }),
      ...(party === "b"
        ? [
            {
              sql: `UPDATE cases SET respondent_user_id = ? WHERE id = ? AND respondent_user_id IS NULL AND ${guard.sql}`,
              args: [userId, row.id, ...guard.args],
            },
          ]
        : []),
    ]);
    won = rs[0].rowsAffected === 1;
  } catch (e) {
    logError("storing the appeal failed", e);
    await refundQuietly(reservationId);
    return { ok: false, code: "unavailable" };
  }

  if (!won) {
    await refundQuietly(reservationId);
    const fresh = await loadCaseBundle((await getCase(row.id)) ?? row);
    if (fresh.appeals.some((a) => a.party === party && a.status === "judged")) return { ok: false, code: "appeal_used" };
    if (fresh.appeals.some((a) => a.status === "judging")) return { ok: false, code: "in_progress" };
    if (party === "b" && fresh.row.respondentUserId && fresh.row.respondentUserId !== userId) {
      return { ok: false, code: "not_party" };
    }
    return { ok: false, code: "case_closed" };
  }
  const appeal = await getAppeal(row.id, party);
  if (appeal && appeal.attemptToken === attemptToken) {
    scheduleJudging(() => runAppealJudging(row.id, appeal.id, attemptToken, startedAt));
  }
  return { ok: true, row: (await getCase(row.id)) ?? row, nameMap: sub.nameMap, replayed: false };
}

/** Exposed for tests and scripts: the expiry statements of one case. */
export { expireStatements };
