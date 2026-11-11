/**
 * A person answers a case with three or four sides. Each side has its own
 * link (B's in the cases row, C's and D's in case_invites), so a link only
 * ever writes its own side. Judging starts when the last side lands and the
 * owner's is in; until then the answers only wait, and no side reads
 * another's. Two-sided cases never come through here (respondToCase).
 */

import { nanoid } from "nanoid";
import type { InStatement } from "@libsql/client";
import type { PartyLetter } from "@/lib/case-types";
import { entitlementWriteBatch, holdStatement, type StatementGuard } from "@/lib/entitlements";
import { anonymizeSubmission, caseNameKeys, type AnonymizedSubmission } from "@/lib/evidence";
import { partiesFor } from "@/lib/multi";
import { ensureOriginalsTables } from "@/lib/originals/db";
import { caseOriginalStatement, sealCaseDisplay } from "@/lib/originals/save";
import type { NameMapping } from "@/lib/types";
import { getCase, getInvites, loadCaseBundle, respondentOf, type CaseRow } from "./db";
import { newInviteNonce } from "./invite";
import { meteredStep, runCaseJudging } from "./judging";
import { notifyOwnerSideWaiting } from "./notify";
import { scheduleJudging } from "./schedule";
import {
  anonymizeFailure,
  boundElsewhere,
  claimFor,
  labelsInUse,
  originalPayload,
  rosterContext,
  sidesOption,
  submissionStatements,
  type Failure,
  type RespondInput,
} from "./service";
import { effectiveStatus, materializeExpiry } from "./sweep";

const LABEL: Record<PartyLetter, "Party A" | "Party B" | "Party C" | "Party D"> = {
  a: "Party A",
  b: "Party B",
  c: "Party C",
  d: "Party D",
};
const MAX_TRIES = 3;

/** `viaSeat`: the caller holds this side's seat, so its nonce is the claim.
 * An answer through an older per-side link never inherits a seat. */
export type RespondSideInput = Omit<RespondInput, "row"> & { row: CaseRow; party: "b" | "c" | "d"; viaSeat?: boolean };

export type RespondSideResult =
  | { ok: true; row: CaseRow; nameMap: NameMapping[]; claim: string | null; replayed: boolean }
  | Failure<"case_expired" | "case_closed" | "unavailable" | "anonymize_failed" | "removed" | "other_side">;

function logError(what: string, e: unknown): void {
  console.error(`[cases] ${what}:`, e instanceof Error ? e.message : String(e));
}

async function closedOrReplay(row: CaseRow, party: PartyLetter, key: string | null, now: Date): Promise<RespondSideResult> {
  const invites = await getInvites(row.id);
  if (key && respondentOf(row, invites, party).idem === key) {
    return { ok: true, row, nameMap: [], claim: claimFor(row, invites, party), replayed: true };
  }
  return { ok: false, code: effectiveStatus(row, now) === "expired" ? "case_expired" : "case_closed" };
}

export async function respondToSide(input: RespondSideInput): Promise<RespondSideResult> {
  const startedAt = Date.now();
  const now = input.now ?? new Date();
  const key = input.idempotencyKey || null;
  const { party } = input;
  let row = input.row;
  if (row.removedAt) return { ok: false, code: "removed" };
  if (!partiesFor(row.sides).includes(party)) return { ok: false, code: "case_closed" };
  await ensureOriginalsTables();

  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const status = effectiveStatus(row, now);
    if (status === "expired") {
      await materializeExpiry(row, now).catch((e: unknown) => logError("expiry failed", e));
      return { ok: false, code: "case_expired" };
    }
    if (status !== "awaiting_respondent") return closedOrReplay(row, party, key, now);

    const bundle = await loadCaseBundle(row);
    if (bundle.sides.some((s) => s.party === party)) return closedOrReplay((await getCase(row.id)) ?? row, party, key, now);
    if (input.userId && boundElsewhere(row, bundle.invites, party, input.userId)) return { ok: false, code: "other_side" };

    // The batch only applies to the state it was prepared for: this many
    // sides in, this one not among them.
    const present = bundle.sides.length;
    const ownerWrote = bundle.sides.some((s) => s.party === "a");
    const complete = ownerWrote && present === row.sides - 1;
    const context = rosterContext(bundle);
    let sub: AnonymizedSubmission;
    try {
      sub = await meteredStep(row.id, `anonymize_${party}`, () =>
        anonymizeSubmission({
          narrator: LABEL[party],
          text: input.text,
          evidence: input.evidence,
          lang: row.lang,
          twoSided: true,
          opponentRequired: true,
          ...sidesOption(row.sides),
          roster: { context, labelsInUse: labelsInUse(context, bundle.people, row.sides) },
          names: { keysFor: caseNameKeys(row.id), known: bundle.people },
        }),
      );
    } catch (e) {
      logError(`anonymizing side ${party} failed`, e);
      return { ok: false, code: anonymizeFailure(e) };
    }

    const nowIso = now.toISOString();
    const token = nanoid(16);
    const guard: StatementGuard = {
      sql: "EXISTS (SELECT 1 FROM cases WHERE id = ? AND judging_token = ?)",
      args: [row.id, token],
    };
    const claimNonce = (input.viaSeat ? bundle.seats.find((s) => s.party === party)?.nonce : undefined) ?? newInviteNonce();
    const display = sealCaseDisplay(row.id, party, input.displayName);
    const original = caseOriginalStatement(
      row.id,
      party,
      "side",
      originalPayload(input.rawText ?? input.text, input.evidence, sub),
      guard,
      nowIso,
    );

    const sets = ["mode = 'two_sided'", "judging_token = ?", "updated_at = ?", `display_${party}_sealed = ?`, "display_key_id = COALESCE(?, display_key_id)"];
    const setArgs: (string | null)[] = [token, nowIso, display?.sealed ?? null, display?.kid ?? null];
    if (party === "b") {
      sets.push("respondent_idem = ?", "respondent_user_id = ?", "respondent_claim_nonce = ?");
      setArgs.push(key, input.userId, claimNonce);
    }
    if (complete) {
      sets.push("status = 'judging'", "judging_started_at = ?", "attempts = attempts + 1", "last_error = NULL");
      setArgs.push(nowIso);
    }
    const where = [
      "id = ?",
      "status = 'awaiting_respondent'",
      "expires_at > ?",
      "removed_at IS NULL",
      "(SELECT COUNT(*) FROM case_sides WHERE case_id = cases.id) = ?",
      `NOT EXISTS (SELECT 1 FROM case_sides WHERE case_id = cases.id AND party = '${party}')`,
    ];
    const whereArgs: (string | number)[] = [row.id, nowIso, present];
    if (input.userId) {
      where.push(`NOT EXISTS (SELECT 1 FROM case_invites WHERE case_id = cases.id AND party <> '${party}' AND user_id = ?)`);
      whereArgs.push(input.userId);
      if (party !== "b") {
        where.push("(respondent_user_id IS NULL OR respondent_user_id <> ?)");
        whereArgs.push(input.userId);
      }
    }
    const store: InStatement = {
      sql: `UPDATE cases SET ${sets.join(", ")} WHERE ${where.join(" AND ")}`,
      args: [...setArgs, ...whereArgs],
    };
    const bind: InStatement[] =
      party === "b"
        ? []
        : [
            {
              sql: `UPDATE case_invites SET respondent_idem = ?, user_id = ?, claim_nonce = ?, answered_at = ?, updated_at = ?
                    WHERE case_id = ? AND party = ? AND answered_at IS NULL AND ${guard.sql}`,
              args: [key, input.userId, claimNonce, nowIso, nowIso, row.id, party, ...guard.args],
            },
          ];

    let won = false;
    try {
      const rs = await entitlementWriteBatch([
        store,
        ...bind,
        ...submissionStatements(row.id, party, sub, guard, nowIso, null),
        ...(original ? [original] : []),
        ...(complete && row.reservationId ? [holdStatement(row.reservationId, nowIso, guard)] : []),
      ]);
      won = rs[0].rowsAffected === 1;
    } catch (e) {
      logError("storing the answer failed", e);
      return { ok: false, code: "unavailable" };
    }
    const fresh = (await getCase(row.id)) ?? row;
    if (won) {
      if (complete) scheduleJudging(() => runCaseJudging(row.id, token, input.origin, startedAt));
      else if (!ownerWrote && present === 0) scheduleJudging(() => notifyOwnerSideWaiting(fresh, input.origin));
      const claim = claimFor(fresh, await getInvites(row.id), party);
      return { ok: true, row: fresh, nameMap: sub.nameMap, claim, replayed: false };
    }
    if (fresh.removedAt) return { ok: false, code: "removed" };
    // Another side landed while this one was being anonymized: go again with
    // it in the roster (and start judging if this is now the last one).
    if (effectiveStatus(fresh, now) === "awaiting_respondent") {
      row = fresh;
      continue;
    }
    return closedOrReplay(fresh, party, key, now);
  }
  return { ok: false, code: "case_closed" };
}
