/**
 * Case operations without HTTP: create, answer, judge now, rotate the
 * invite, appeal. Removal (of one side, or everything on account deletion)
 * lives in lib/originals/removal and never deletes rows. Gates (session,
 * origin, limits) are the caller's; these functions own state checks,
 * credits and writes.
 *
 * Every multi-row write is one guarded batch through entitlementWriteBatch.
 * A statement that must only apply if an earlier one did is guarded with
 * EXISTS on a fresh token (judging_token / attempt_token) or a fresh id.
 * A case can start without side A (the owner sends the link first): the
 * state is derived from which case_sides rows exist, and a write that
 * depends on the other side's absence says so in its WHERE clause.
 * Each submission is anonymized once, when it is submitted; the anonymized
 * text and keyed name fingerprints are written in the clear, the original
 * (text as written, raw transcripts, name map) and the display name sealed
 * (lib/originals). Without an originals key the sealed parts are skipped.
 */

import { nanoid } from "nanoid";
import type { InStatement } from "@libsql/client";
import { CASE_EXPIRY_DAYS, type PartyLetter } from "@/lib/case-types";
import type { PremiumBlock } from "@/lib/account-types";
import { STORED_FRAMEWORK } from "@/lib/db";
import {
  entitlementWriteBatch,
  holdStatement,
  refundPremiumVerdict,
  reservationByKey,
  reservePremiumVerdict,
  type StatementGuard,
} from "@/lib/entitlements";
import { ensureOriginalsTables } from "@/lib/originals/db";
import { caseOriginalStatement, sealCaseDisplay } from "@/lib/originals/save";
import type { OriginalPayload } from "@/lib/originals-types";
import { track } from "@/lib/analytics/track";
import { AnonymizeError, sideLabels } from "@/lib/anonymize";
import {
  anonymizeSubmission,
  caseNameKeys,
  type AnonymizedSubmission,
  type KnownPerson,
  type VerifiedEvidence,
} from "@/lib/evidence";
import type { Lang } from "@/lib/i18n";
import { partiesFor } from "@/lib/multi";
import type { NameMapping } from "@/lib/types";
import { composeForJudging } from "./compose";
import {
  getAppeal,
  getCase,
  getCaseByOwnerKey,
  hasSide,
  loadCaseBundle,
  respondentOf,
  type CaseBundle,
  type CaseRow,
  type InviteRow,
} from "./db";
import { claimMatches, inviteHash, inviteToken, newInviteNonce, respondentClaim } from "./invite";
import { meteredStep, runAppealJudging, runCaseJudging } from "./judging";
import type { Venue } from "@/lib/venues";
import { notifyOwnerSideWaiting } from "./notify";
import { scheduleJudging } from "./schedule";
import { seatHolds } from "./seats";
import { effectiveStatus, expireStatements, materializeExpiry } from "./sweep";

const DAY_MS = 24 * 60 * 60 * 1000;

export type Blocked = { ok: false; code: PremiumBlock; resetsAt?: string };
export type Failure<C extends string> = { ok: false; code: C };

const LABEL: Record<PartyLetter, "Party A" | "Party B" | "Party C" | "Party D"> = {
  a: "Party A",
  b: "Party B",
  c: "Party C",
  d: "Party D",
};

/** What the anonymizer is told when a case has three or four sides. The
 * owner names nobody, so no side has a name. */
export function sidesOption(count: number): { sides: { count: number; names: null[] } } | Record<string, never> {
  return count > 2 ? { sides: { count, names: Array<null>(count).fill(null) } } : {};
}

function logError(what: string, e: unknown): void {
  console.error(`[cases] ${what}:`, e instanceof Error ? e.message : String(e));
}

export async function refundQuietly(reservationId: string | null): Promise<void> {
  if (!reservationId) return;
  try {
    await refundPremiumVerdict(reservationId);
  } catch (e) {
    logError("refund failed", e);
  }
}

/** Rows that persist one anonymized submission (side or appeal), each
 * guarded so nothing is written unless the state change it belongs to was. */
export function submissionStatements(
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
export function labelsInUse(context: string, people: readonly KnownPerson[], sides = 2): string[] {
  const found = new Set<string>([...sideLabels(sides), ...people.map((p) => p.label)]);
  const person = sides > 2 ? /(?<![\p{L}])(Person [E-Z])(?![\p{L}\p{N}])/gu : /(?<![\p{L}])(Person [C-Z])(?![\p{L}\p{N}])/gu;
  for (const m of context.matchAll(person)) found.add(m[1]);
  return [...found];
}

/** The sealed original of one submission: the text exactly as received,
 * the raw transcripts of its screenshots, and its name map. */
export function originalPayload(text: string, evidence: readonly VerifiedEvidence[], sub: AnonymizedSubmission): OriginalPayload {
  return {
    v: 1,
    text,
    ...(evidence.length ? { evidence: evidence.map((e) => ({ kind: e.kind, transcript: e.transcript })) } : {}),
    nameMap: sub.nameMap,
  };
}

/** SQL: the case has (or has not) a row for `party`, inside a statement on cases. */
const sideExists = (party: PartyLetter, yes: boolean) =>
  `${yes ? "" : "NOT "}EXISTS (SELECT 1 FROM case_sides WHERE case_id = cases.id AND party = '${party}')`;

export function rosterContext(bundle: CaseBundle): string {
  const mode = bundle.row.mode ?? (bundle.sides.some((s) => s.party === "b") ? "two_sided" : "one_sided");
  const earlier = bundle.appeals.filter((a) => a.status === "judged");
  const doc = composeForJudging(bundle.sides, mode, { earlier, current: null }, bundle.row.sides);
  const transcripts = bundle.evidence.map((e) => e.transcript).join("\n\n");
  return transcripts ? `${doc}\n\n${transcripts}` : doc;
}

// --- Create -----------------------------------------------------------------------

export type CreateCaseInput = {
  ownerId: string;
  /** Left out when the owner sends the link before writing their side. */
  text?: string;
  lang: Lang;
  evidence: VerifiedEvidence[];
  idempotencyKey?: string;
  /** The side exactly as received (before trimming), for the sealed original. */
  rawText?: string;
  /** How the owner wants to appear on the share pages (null = Party A). */
  displayName?: string | null;
  /** 3 or 4 for a case with that many sides; B, C and D each get a link. */
  sides?: number;
  venue?: Venue | null;
  now?: Date;
};

export type CreateCaseResult =
  | { ok: true; row: CaseRow; nameMap: NameMapping[]; replayed: boolean }
  | Blocked
  | Failure<"unavailable" | "in_progress" | "anonymize_failed">;

/** A failed anonymization: "anonymize_failed" when a name could not be taken
 * out of the text (the person can rewrite it, e.g. with initials, and try
 * again), else "unavailable" (a refusal, a timeout, an API or output error). */
export function anonymizeFailure(e: unknown): "anonymize_failed" | "unavailable" {
  return e instanceof AnonymizeError && /survived|identical to the input/.test(e.message) ? "anonymize_failed" : "unavailable";
}

export async function createCase(input: CreateCaseInput): Promise<CreateCaseResult> {
  await ensureOriginalsTables();
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
  const count = Math.max(2, Math.min(4, input.sides ?? 2));

  const caseId = nanoid(12);
  const nonce = newInviteNonce();
  const token = inviteToken(caseId, nonce);
  // Side C and D's links: a nonce each, kept in case_invites.
  const extra = partiesFor(count).slice(2).map((party) => {
    const n = newInviteNonce();
    const t = inviteToken(caseId, n);
    return { party, nonce: n, hash: t ? inviteHash(t) : null };
  });
  if (!token || extra.some((e) => e.hash === null)) {
    await refundQuietly(reservationId);
    return { ok: false, code: "unavailable" };
  }

  let sub: AnonymizedSubmission | null = null;
  try {
    if (input.text !== undefined) {
      const text = input.text;
      sub = await meteredStep(caseId, "anonymize_a", () =>
        anonymizeSubmission({
          narrator: "Party A",
          text,
          evidence: input.evidence,
          lang: input.lang,
          twoSided: true,
          opponentRequired: true,
          ...sidesOption(count),
          names: { keysFor: caseNameKeys(caseId), known: [] },
        }),
      );
    }
  } catch (e) {
    logError("anonymizing side A failed", e);
    await refundQuietly(reservationId);
    return { ok: false, code: anonymizeFailure(e) };
  }

  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + CASE_EXPIRY_DAYS * DAY_MS).toISOString();
  const guard: StatementGuard = { sql: "EXISTS (SELECT 1 FROM cases WHERE id = ?)", args: [caseId] };
  const display = sealCaseDisplay(caseId, "a", input.displayName);
  const original =
    sub && input.text !== undefined
      ? caseOriginalStatement(caseId, "a", "side", originalPayload(input.rawText ?? input.text, input.evidence, sub), guard, nowIso)
      : null;
  let inserted = false;
  try {
    const rs = await entitlementWriteBatch([
      {
        sql: `INSERT INTO cases
                (id, owner_id, status, mode, tier, framework, lang, invite_nonce, invite_hash, idempotency_key,
                 reservation_id, expires_at, created_at, updated_at, display_a_sealed, display_key_id, sides, venue)
              VALUES (?, ?, 'awaiting_respondent', NULL, 'premium', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT DO NOTHING`,
        args: [
          caseId,
          input.ownerId,
          STORED_FRAMEWORK,
          input.lang,
          nonce,
          inviteHash(token),
          key,
          reservationId,
          expiresAt,
          nowIso,
          nowIso,
          display?.sealed ?? null,
          display?.kid ?? null,
          count,
          input.venue ?? null,
        ],
      },
      ...extra.map((e) => ({
        sql: `INSERT INTO case_invites (case_id, party, invite_nonce, invite_hash, created_at, updated_at)
              SELECT ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`,
        args: [caseId, e.party, e.nonce, e.hash, nowIso, nowIso, ...guard.args],
      })),
      ...(sub ? submissionStatements(caseId, "a", sub, guard, nowIso, null) : []),
      ...(original ? [original] : []),
      // The unit stays held until the invite expires (then the usual
      // 10-minute stale rule applies).
      ...(reservationId ? [holdStatement(reservationId, expiresAt, guard)] : []),
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
  void track("case_created", { userId: input.ownerId, props: { mode: count > 2 ? "many_sided" : (row.mode ?? "two_sided") } });
  return { ok: true, row, nameMap: sub?.nameMap ?? [], replayed: false };
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
  /** The side exactly as received (before trimming), for the sealed original. */
  rawText?: string;
  /** How the respondent wants to appear on the share pages (null = Party B). */
  displayName?: string | null;
  /** The nonce of the seat this answer was proven through; the store only
   * applies while that seat still has it. */
  seatNonce?: string;
  now?: Date;
};

/** The extra condition that ties a store to the seat it was proven through. */
export function seatGuard(party: string, nonce: string | undefined): { sql: string; args: string[] } {
  if (!nonce) return { sql: "", args: [] };
  return {
    sql: ` AND EXISTS (SELECT 1 FROM case_seats WHERE case_id = cases.id AND party = '${party}' AND nonce = ?)`,
    args: [nonce],
  };
}

export type RespondResult =
  | { ok: true; row: CaseRow; nameMap: NameMapping[]; claim: string | null; replayed: boolean }
  | Failure<"case_expired" | "case_closed" | "unavailable" | "anonymize_failed" | "removed">;

/** The claim secret for whoever answered signed out (null once an account
 * is bound to side B, or when side B predates claims). */
export function claimFor(row: CaseRow, invites: readonly InviteRow[] = [], party: PartyLetter = "b"): string | null {
  const who = respondentOf(row, invites, party);
  if (who.userId || !who.claimNonce) return null;
  return respondentClaim(row.id, who.claimNonce);
}

function closedOrReplay(row: CaseRow, key: string | null, now: Date): RespondResult {
  if (key && row.respondentIdem === key) return { ok: true, row, nameMap: [], claim: claimFor(row), replayed: true };
  return { ok: false, code: effectiveStatus(row, now) === "expired" ? "case_expired" : "case_closed" };
}

export async function respondToCase(input: RespondInput): Promise<RespondResult> {
  const startedAt = Date.now();
  const now = input.now ?? new Date();
  const key = input.idempotencyKey || null;
  let row = input.row;
  if (row.removedAt) return { ok: false, code: "removed" };
  await ensureOriginalsTables();

  for (let attempt = 0; ; attempt++) {
    const status = effectiveStatus(row, now);
    if (status === "expired") {
      await materializeExpiry(row, now).catch((e: unknown) => logError("expiry failed", e));
      return { ok: false, code: "case_expired" };
    }
    if (status !== "awaiting_respondent") return closedOrReplay(row, key, now);

    const bundle = await loadCaseBundle(row);
    if (bundle.sides.some((s) => s.party === "b")) return closedOrReplay((await getCase(row.id)) ?? row, key, now);
    const ownerWrote = bundle.sides.some((s) => s.party === "a");
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
          opponentRequired: true,
          roster: { context, labelsInUse: labelsInUse(context, bundle.people) },
          names: { keysFor: caseNameKeys(row.id), known: bundle.people },
        }),
      );
    } catch (e) {
      logError("anonymizing side B failed", e);
      return { ok: false, code: anonymizeFailure(e) };
    }

    const nowIso = now.toISOString();
    const token = nanoid(16);
    const guard: StatementGuard = {
      sql: "EXISTS (SELECT 1 FROM cases WHERE id = ? AND judging_token = ?)",
      args: [row.id, token],
    };
    // Side B's author: the signed-in account, else whoever holds the claim
    // secret derived from this nonce (returned in this response).
    const claimNonce = input.seatNonce ?? newInviteNonce();
    const display = sealCaseDisplay(row.id, "b", input.displayName);
    const original = caseOriginalStatement(
      row.id,
      "b",
      "side",
      originalPayload(input.rawText ?? input.text, input.evidence, sub),
      guard,
      nowIso,
    );
    const bindings = [key, input.userId, claimNonce, nowIso, display?.sealed ?? null, display?.kid ?? null, row.id, nowIso];
    // With side A in, judging starts and the held unit gets the usual
    // 10-minute crash clock. Without it the answer is only stored: the case
    // keeps waiting, the unit stays held until the invite expires, and the
    // token only guards this batch's rows.
    const held = seatGuard("b", input.seatNonce);
    const stored: { sql: string; args: (string | number | null)[] } = ownerWrote
      ? {
          sql: `UPDATE cases SET status = 'judging', mode = 'two_sided', judging_token = ?, judging_started_at = ?,
                  respondent_idem = ?, respondent_user_id = ?, respondent_claim_nonce = ?,
                  attempts = attempts + 1, last_error = NULL, updated_at = ?,
                  display_b_sealed = ?, display_key_id = COALESCE(?, display_key_id)
                WHERE id = ? AND status = 'awaiting_respondent' AND expires_at > ? AND removed_at IS NULL`,
          args: [token, nowIso, ...bindings],
        }
      : {
          sql: `UPDATE cases SET mode = 'two_sided', judging_token = ?,
                  respondent_idem = ?, respondent_user_id = ?, respondent_claim_nonce = ?,
                  updated_at = ?, display_b_sealed = ?, display_key_id = COALESCE(?, display_key_id)
                WHERE id = ? AND status = 'awaiting_respondent' AND expires_at > ? AND removed_at IS NULL
                  AND ${sideExists("a", false)} AND ${sideExists("b", false)}`,
          args: [token, ...bindings],
        };
    const store: InStatement = { sql: stored.sql + held.sql, args: [...stored.args, ...held.args] };
    let won = false;
    try {
      const rs = await entitlementWriteBatch([
        store,
        ...submissionStatements(row.id, "b", sub, guard, nowIso, null),
        ...(original ? [original] : []),
        ...(ownerWrote && row.reservationId ? [holdStatement(row.reservationId, nowIso, guard)] : []),
      ]);
      won = rs[0].rowsAffected === 1;
    } catch (e) {
      logError("storing the answer failed", e);
      return { ok: false, code: "unavailable" };
    }
    const fresh = (await getCase(row.id)) ?? row;
    if (won) {
      if (ownerWrote) scheduleJudging(() => runCaseJudging(row.id, token, input.origin, startedAt));
      else scheduleJudging(() => notifyOwnerSideWaiting(fresh, input.origin));
      return { ok: true, row: fresh, nameMap: sub.nameMap, claim: claimFor(fresh), replayed: false };
    }
    if (fresh.removedAt) return { ok: false, code: "removed" };
    if (input.seatNonce && !(await seatHolds(row.id, "b", input.seatNonce))) return { ok: false, code: "case_closed" };
    // Side A may have landed while this was being anonymized: go again with
    // it in the roster. Anything else that changed closes the case.
    if (attempt === 0 && effectiveStatus(fresh, now) === "awaiting_respondent") {
      row = fresh;
      continue;
    }
    return closedOrReplay(fresh, key, now);
  }
}

// --- Owner writes side A -------------------------------------------------------------

export type WriteSideInput = {
  row: CaseRow;
  text: string;
  evidence: VerifiedEvidence[];
  origin: string;
  /** The side exactly as received (before trimming), for the sealed original. */
  rawText?: string;
  displayName?: string | null;
  now?: Date;
};

export type WriteSideResult =
  | { ok: true; row: CaseRow; nameMap: NameMapping[]; replayed: boolean }
  | Failure<"case_expired" | "case_closed" | "unavailable" | "anonymize_failed" | "removed">;

/** The owner writes side A of a case started without one. When side B is
 * already in, this write also starts judging. A case that already has side
 * A answers ok with its current state (a retry). */
export async function writeOwnerSide(input: WriteSideInput): Promise<WriteSideResult> {
  const startedAt = Date.now();
  const now = input.now ?? new Date();
  let row = input.row;
  if (row.removedAt) return { ok: false, code: "removed" };
  await ensureOriginalsTables();

  for (let attempt = 0; ; attempt++) {
    const bundle = await loadCaseBundle(row);
    if (bundle.sides.some((s) => s.party === "a")) return { ok: true, row, nameMap: [], replayed: true };
    const status = effectiveStatus(row, now);
    if (status === "expired") {
      await materializeExpiry(row, now).catch((e: unknown) => logError("expiry failed", e));
      return { ok: false, code: "case_expired" };
    }
    if (status !== "awaiting_respondent") return { ok: false, code: "case_closed" };
    const many = row.sides > 2;
    // With more sides, judging starts when every other side is in.
    const answered = many ? bundle.sides.length === row.sides - 1 : bundle.sides.some((s) => s.party === "b");
    const anyAnswer = bundle.sides.length > 0;
    const context = rosterContext(bundle);

    let sub: AnonymizedSubmission;
    try {
      sub = await meteredStep(row.id, "anonymize_a", () =>
        anonymizeSubmission({
          narrator: "Party A",
          text: input.text,
          evidence: input.evidence,
          lang: row.lang,
          twoSided: true,
          opponentRequired: true,
          ...sidesOption(row.sides),
          ...((many ? anyAnswer : answered)
            ? { roster: { context, labelsInUse: labelsInUse(context, bundle.people, row.sides) } }
            : {}),
          names: { keysFor: caseNameKeys(row.id), known: bundle.people },
        }),
      );
    } catch (e) {
      logError("anonymizing side A failed", e);
      return { ok: false, code: anonymizeFailure(e) };
    }

    const nowIso = now.toISOString();
    const token = nanoid(16);
    const guard: StatementGuard = {
      sql: "EXISTS (SELECT 1 FROM cases WHERE id = ? AND judging_token = ?)",
      args: [row.id, token],
    };
    const display = sealCaseDisplay(row.id, "a", input.displayName);
    const original = caseOriginalStatement(
      row.id,
      "a",
      "side",
      originalPayload(input.rawText ?? input.text, input.evidence, sub),
      guard,
      nowIso,
    );
    // Side B's presence is part of the condition either way: the batch only
    // applies to the state it was prepared for.
    const open = many
      ? `WHERE id = ? AND status = 'awaiting_respondent' AND expires_at > ? AND removed_at IS NULL
           AND ${sideExists("a", false)} AND (SELECT COUNT(*) FROM case_sides WHERE case_id = cases.id) = ${bundle.sides.length}`
      : `WHERE id = ? AND status = 'awaiting_respondent' AND expires_at > ? AND removed_at IS NULL
                    AND ${sideExists("a", false)} AND ${sideExists("b", answered)}`;
    const store: InStatement = answered
      ? {
          sql: `UPDATE cases SET status = 'judging', mode = 'two_sided', judging_token = ?, judging_started_at = ?,
                  attempts = attempts + 1, last_error = NULL, updated_at = ?,
                  display_a_sealed = COALESCE(?, display_a_sealed), display_key_id = COALESCE(?, display_key_id)
                ${open}`,
          args: [token, nowIso, nowIso, display?.sealed ?? null, display?.kid ?? null, row.id, nowIso],
        }
      : {
          sql: `UPDATE cases SET judging_token = ?, updated_at = ?,
                  display_a_sealed = COALESCE(?, display_a_sealed), display_key_id = COALESCE(?, display_key_id)
                ${open}`,
          args: [token, nowIso, display?.sealed ?? null, display?.kid ?? null, row.id, nowIso],
        };
    let won = false;
    try {
      const rs = await entitlementWriteBatch([
        store,
        ...submissionStatements(row.id, "a", sub, guard, nowIso, null),
        ...(original ? [original] : []),
        ...(answered && row.reservationId ? [holdStatement(row.reservationId, nowIso, guard)] : []),
      ]);
      won = rs[0].rowsAffected === 1;
    } catch (e) {
      logError("storing side A failed", e);
      return { ok: false, code: "unavailable" };
    }
    const fresh = (await getCase(row.id)) ?? row;
    if (won) {
      if (answered) scheduleJudging(() => runCaseJudging(row.id, token, input.origin, startedAt));
      return { ok: true, row: fresh, nameMap: sub.nameMap, replayed: false };
    }
    if (fresh.removedAt) return { ok: false, code: "removed" };
    // The other side may have landed meanwhile (then this write is the one
    // that starts judging), or a retry of this very write won.
    if (attempt === 0) {
      row = fresh;
      continue;
    }
    return { ok: false, code: effectiveStatus(fresh, now) === "expired" ? "case_expired" : "case_closed" };
  }
}

// --- Judge now / retry -------------------------------------------------------------

export type JudgeNowResult =
  | { ok: true; row: CaseRow; started: boolean }
  | Blocked
  | Failure<"invalid" | "side_missing" | "case_closed" | "unavailable" | "removed">;

/**
 * awaiting + only_mine: judge side A alone with the held unit (the invite
 * closes). expired: a new unit, one-sided. failed: a new unit, same mode.
 * Already judging or judged: no-op (idempotent). Nothing runs while side A
 * is still missing.
 */
export async function judgeNow(input: {
  row: CaseRow;
  mode?: "only_mine" | "answered";
  origin: string;
  now?: Date;
}): Promise<JudgeNowResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  let row = input.row;
  if (row.removedAt) return { ok: false, code: "removed" };
  if (!(await hasSide(row.id, "a"))) return { ok: false, code: "side_missing" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const status = effectiveStatus(row, now);
    if (status === "judging" || status === "judged") return { ok: true, row, started: false };

    if (status === "awaiting_respondent") {
      if (input.mode === "answered" && row.sides > 2) return judgeAnswered(row, input.origin, now, "awaiting_respondent");
      if (input.mode !== "only_mine") return { ok: false, code: "invalid" };
      const token = nanoid(16);
      const guard: StatementGuard = {
        sql: "EXISTS (SELECT 1 FROM cases WHERE id = ? AND judging_token = ?)",
        args: [row.id, token],
      };
      const rs = await entitlementWriteBatch([
        {
          sql: `UPDATE cases SET status = 'judging', mode = 'one_sided', sides = 2, judging_token = ?, judging_started_at = ?,
                  attempts = attempts + 1, last_error = NULL, updated_at = ?
                WHERE id = ? AND status = 'awaiting_respondent' AND expires_at > ? AND removed_at IS NULL`,
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

    if (status === "expired" && input.mode === "answered" && row.sides > 2) return judgeAnswered(row, input.origin, now, "expired");

    // expired or failed: a fresh unit funds the run, on an old free case too.
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
          sql: `UPDATE cases SET status = 'judging', mode = ${from === "expired" ? "'one_sided', sides = 2" : "COALESCE(mode, 'one_sided')"},
                  reservation_id = ?, judging_token = ?, judging_started_at = ?, attempts = attempts + 1,
                  last_error = NULL, updated_at = ?
                WHERE id = ? AND status = ? AND removed_at IS NULL`,
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

/**
 * A case with three or four sides, owner going ahead: judge the sides that
 * answered. They must be A, B, C... without a gap (letters are baked into
 * each anonymized account), and at least two. The case then has that many
 * sides: with two it is an ordinary two-sided case, and the links of the
 * sides that did not answer stop working (the case is no longer awaiting).
 * Once the invites expired the held unit is gone, so a fresh one funds the run.
 */
async function judgeAnswered(
  row: CaseRow,
  origin: string,
  now: Date,
  from: "awaiting_respondent" | "expired",
): Promise<JudgeNowResult> {
  const nowIso = now.toISOString();
  const bundle = await loadCaseBundle(row);
  const present = new Set(bundle.sides.map((s) => s.party));
  const count = partiesFor(row.sides).filter((p) => present.has(p)).length;
  const prefix = partiesFor(count);
  if (count < 2 || !present.has("a") || bundle.sides.length !== count || !prefix.every((p) => present.has(p))) {
    return { ok: false, code: "side_missing" };
  }
  let reservationId: string | null = null;
  if (from === "expired") {
    await materializeExpiry(row, now);
    const reserved = await reservePremiumVerdict(row.ownerId, { now });
    if (!reserved.ok) {
      if (reserved.code === "premium_required" || reserved.code === "no_credits" || reserved.code === "fair_use") {
        return { ok: false, code: reserved.code, ...("resetsAt" in reserved && reserved.resetsAt ? { resetsAt: reserved.resetsAt } : {}) };
      }
      return { ok: false, code: "unavailable" };
    }
    reservationId = reserved.reservation.id;
  }
  const token = nanoid(16);
  const guard: StatementGuard = {
    sql: "EXISTS (SELECT 1 FROM cases WHERE id = ? AND judging_token = ?)",
    args: [row.id, token],
  };
  const countIs = `(SELECT COUNT(*) FROM case_sides WHERE case_id = cases.id) = ?`;
  const write =
    from === "expired"
      ? {
          sql: `UPDATE cases SET status = 'judging', mode = 'two_sided', sides = ?, reservation_id = ?, judging_token = ?,
                  judging_started_at = ?, attempts = attempts + 1, last_error = NULL, updated_at = ?
                WHERE id = ? AND status = 'expired' AND removed_at IS NULL AND ${countIs}`,
          args: [count, reservationId, token, nowIso, nowIso, row.id, count],
        }
      : {
          sql: `UPDATE cases SET status = 'judging', mode = 'two_sided', sides = ?, judging_token = ?, judging_started_at = ?,
                  attempts = attempts + 1, last_error = NULL, updated_at = ?
                WHERE id = ? AND status = 'awaiting_respondent' AND expires_at > ? AND removed_at IS NULL AND ${countIs}`,
          args: [count, token, nowIso, nowIso, row.id, nowIso, count],
        };
  let won = false;
  try {
    const rs = await entitlementWriteBatch([
      write,
      ...(from === "awaiting_respondent" && row.reservationId ? [holdStatement(row.reservationId, nowIso, guard)] : []),
    ]);
    won = rs[0].rowsAffected === 1;
  } catch (e) {
    logError("starting a judging run failed", e);
  }
  if (!won && reservationId) await refundQuietly(reservationId);
  const fresh = (await getCase(row.id)) ?? row;
  if (won) {
    scheduleJudging(() => runCaseJudging(row.id, token, origin));
    return { ok: true, row: fresh, started: true };
  }
  // Another answer arrived, or the case moved on: the owner looks again.
  const status = effectiveStatus(fresh, now);
  return status === "judging" || status === "judged" ? { ok: true, row: fresh, started: false } : { ok: false, code: "case_closed" };
}

// --- Invite --------------------------------------------------------------------------

export type RotateResult = { ok: true; row: CaseRow; token: string } | Failure<"case_closed" | "unavailable" | "removed">;

export async function rotateInvite(row: CaseRow, now: Date = new Date()): Promise<RotateResult> {
  if (row.removedAt) return { ok: false, code: "removed" };
  if (effectiveStatus(row, now) !== "awaiting_respondent") return { ok: false, code: "case_closed" };
  const nonce = newInviteNonce();
  const token = inviteToken(row.id, nonce);
  if (!token) return { ok: false, code: "unavailable" };
  const nowIso = now.toISOString();
  // The old token is kept as retired: it still serves a request that proves a
  // seat or an answer, so a side mid-answer or already answered keeps working,
  // but it takes no new seat. With every side seated there is nothing to rotate.
  const hash = inviteHash(token);
  const oldToken = inviteToken(row.id, row.inviteNonce);
  const rs = await entitlementWriteBatch([
    {
      sql: `UPDATE cases SET invite_nonce = ?, invite_hash = ?, updated_at = ?
            WHERE id = ? AND status = 'awaiting_respondent' AND expires_at > ? AND removed_at IS NULL
              AND (SELECT COUNT(*) FROM (
                     SELECT party FROM case_seats WHERE case_id = cases.id
                     UNION SELECT party FROM case_sides WHERE case_id = cases.id AND party <> 'a')) < sides - 1`,
      args: [nonce, hash, nowIso, row.id, nowIso],
    },
    {
      sql: `INSERT OR IGNORE INTO case_retired_links (invite_hash, case_id)
            SELECT ?, ? WHERE EXISTS (SELECT 1 FROM cases WHERE id = ? AND invite_hash = ?)`,
      args: [oldToken ? inviteHash(oldToken) : row.inviteHash, row.id, row.id, hash],
    },
  ]);
  if (rs[0].rowsAffected !== 1) return { ok: false, code: "case_closed" };
  return { ok: true, row: (await getCase(row.id)) ?? row, token };
}

/** The owner's current invite token, healing invite_hash when the derived
 * token changed (the secret was rotated; the old link was dead anyway). */
export async function currentInviteToken(row: CaseRow, invite?: InviteRow): Promise<string | null> {
  const token = inviteToken(row.id, invite ? invite.inviteNonce : row.inviteNonce);
  if (!token) return null;
  const hash = inviteHash(token);
  if (invite) {
    if (hash !== invite.inviteHash && row.status === "awaiting_respondent") {
      try {
        await entitlementWriteBatch([
          {
            sql: "UPDATE case_invites SET invite_hash = ? WHERE case_id = ? AND party = ? AND invite_nonce = ?",
            args: [hash, row.id, invite.party, invite.inviteNonce],
          },
        ]);
      } catch (e) {
        logError("updating the invite hash failed", e);
      }
    }
    return token;
  }
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
  /** The appeal exactly as received (before trimming), for the sealed original. */
  rawText?: string;
  now?: Date;
};

export type AppealResult =
  | { ok: true; row: CaseRow; nameMap: NameMapping[]; replayed: boolean }
  | Blocked
  | Failure<"case_closed" | "appeal_used" | "in_progress" | "not_party" | "unavailable" | "anonymize_failed" | "removed">;

/** Party B is the account bound when side B was written, or (while none is
 * bound) a signed-in account holding the claim secret; never the owner. */
export function mayActAsRespondent(row: CaseRow, userId: string, claim: string | null | undefined): boolean {
  if (row.mode !== "two_sided" || userId === row.ownerId) return false;
  if (row.respondentUserId) return row.respondentUserId === userId;
  return claimMatches(row, claim);
}

/** Whether `userId` already answers for a side of the case other than `party`
 * (a person is one side of a case, and never also its owner). */
export function boundElsewhere(row: CaseRow, invites: readonly InviteRow[], party: PartyLetter, userId: string): boolean {
  if (userId === row.ownerId) return true;
  if (party !== "b" && row.respondentUserId === userId) return true;
  return invites.some((i) => i.party !== party && i.userId === userId);
}

/** The same for any side but A: B's binding is in the case row, C's and D's
 * in their invite. */
export function mayActAsParty(
  row: CaseRow,
  invites: readonly InviteRow[],
  party: PartyLetter,
  userId: string,
  claim: string | null | undefined,
): boolean {
  if (row.mode !== "two_sided" || userId === row.ownerId || party === "a") return false;
  const who = respondentOf(row, invites, party);
  if (who.userId) return who.userId === userId;
  return claimMatches({ id: row.id, respondentClaimNonce: who.claimNonce }, claim);
}

/** The premium unit an appeal spends (case or one-sided verdict).
 * `replayed`: the Idempotency-Key already holds or spent one. */
export async function reserveAppealUnit(
  userId: string,
  usageKey: string | undefined,
  now: Date,
): Promise<{ reservationId: string } | { replayed: true } | Blocked | Failure<"unavailable">> {
  const reserved = await reservePremiumVerdict(userId, { ...(usageKey ? { idempotencyKey: usageKey } : {}), now });
  if (reserved.ok) return { reservationId: reserved.reservation.id };
  if (reserved.code === "premium_required" || reserved.code === "no_credits" || reserved.code === "fair_use") {
    return { ok: false, code: reserved.code, ...("resetsAt" in reserved && reserved.resetsAt ? { resetsAt: reserved.resetsAt } : {}) };
  }
  if (reserved.code === "replay" || reserved.code === "in_progress") return { replayed: true };
  return { ok: false, code: "unavailable" };
}

export async function submitAppeal(input: AppealInput): Promise<AppealResult> {
  const startedAt = Date.now();
  const now = input.now ?? new Date();
  const { row, party, userId } = input;
  if (row.removedAt) return { ok: false, code: "removed" };
  if (effectiveStatus(row, now) !== "judged") return { ok: false, code: "case_closed" };
  await ensureOriginalsTables();
  const usageKey = input.idempotencyKey ? `appeal:${row.id}:${input.idempotencyKey}` : undefined;

  if (usageKey) {
    const prior = await reservationByKey(userId, usageKey);
    if (prior && prior.status !== "refunded") return { ok: true, row, nameMap: [], replayed: true };
  }

  const bundle = await loadCaseBundle(row);
  if (bundle.verdicts.length === 0) return { ok: false, code: "case_closed" };
  if (party === "a" ? userId !== row.ownerId : !mayActAsParty(row, bundle.invites, party, userId, input.claim)) {
    return { ok: false, code: "not_party" };
  }
  if (party !== "a" && boundElsewhere(row, bundle.invites, party, userId)) return { ok: false, code: "not_party" };
  if (bundle.appeals.some((a) => a.party === party && a.status === "judged")) return { ok: false, code: "appeal_used" };
  if (bundle.appeals.some((a) => a.status === "judging")) return { ok: false, code: "in_progress" };

  const unit = await reserveAppealUnit(userId, usageKey, now);
  if ("replayed" in unit) return { ok: true, row, nameMap: [], replayed: true };
  if (!("reservationId" in unit)) return unit;
  const { reservationId } = unit;

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
        ...(row.mode === "two_sided" ? sidesOption(row.sides) : {}),
        roster: { context, labelsInUse: labelsInUse(context, bundle.people, row.mode === "two_sided" ? row.sides : 2) },
        names: { keysFor: caseNameKeys(row.id), known: bundle.people },
      }),
    );
  } catch (e) {
    logError("anonymizing the appeal failed", e);
    await refundQuietly(reservationId);
    return { ok: false, code: anonymizeFailure(e) };
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
    party === "b"
      ? `AND ((SELECT respondent_user_id FROM cases WHERE id = ?) IS NULL OR (SELECT respondent_user_id FROM cases WHERE id = ?) = ?)
         AND NOT EXISTS (SELECT 1 FROM case_invites WHERE case_id = ? AND user_id = ?)`
      : party === "a"
        ? ""
        : `AND ((SELECT user_id FROM case_invites WHERE case_id = ? AND party = ?) IS NULL OR (SELECT user_id FROM case_invites WHERE case_id = ? AND party = ?) = ?)
           AND NOT EXISTS (SELECT 1 FROM cases WHERE id = ? AND respondent_user_id = ?)
           AND NOT EXISTS (SELECT 1 FROM case_invites WHERE case_id = ? AND party <> ? AND user_id = ?)`;
  const original = caseOriginalStatement(
    row.id,
    party,
    "appeal",
    originalPayload(input.rawText ?? input.text, input.evidence, sub),
    guard,
    nowIso,
  );
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
              WHERE EXISTS (SELECT 1 FROM cases WHERE id = ? AND status = 'judged' AND removed_at IS NULL)
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
          ...(party === "b"
            ? [row.id, row.id, userId, row.id, userId]
            : party === "a"
              ? []
              : [row.id, party, row.id, party, userId, row.id, userId, row.id, party, userId]),
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
      ...(original ? [original] : []),
      ...(party === "b"
        ? [
            {
              sql: `UPDATE cases SET respondent_user_id = ? WHERE id = ? AND respondent_user_id IS NULL AND ${guard.sql}`,
              args: [userId, row.id, ...guard.args],
            },
          ]
        : party === "a"
          ? []
          : [
              {
                sql: `UPDATE case_invites SET user_id = ? WHERE case_id = ? AND party = ? AND user_id IS NULL AND ${guard.sql}`,
                args: [userId, row.id, party, ...guard.args],
              },
            ]),
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
    if (fresh.row.removedAt) return { ok: false, code: "removed" };
    if (fresh.appeals.some((a) => a.party === party && a.status === "judged")) return { ok: false, code: "appeal_used" };
    if (fresh.appeals.some((a) => a.status === "judging")) return { ok: false, code: "in_progress" };
    const bound = respondentOf(fresh.row, fresh.invites, party).userId;
    if (party !== "a" && bound && bound !== userId) {
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
