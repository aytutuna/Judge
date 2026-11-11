/**
 * One link per case. Opening it takes the next open side, B then C then D, in
 * a row of case_seats; the insert is the atomic step, so two people opening at
 * once land on different sides. The seat's nonce becomes the claim secret
 * (the same value before and after the answer), so the person is found again
 * by that secret or by their account.
 *
 * A seat that was opened and left alone for SEAT_IDLE_MS, with no account
 * behind it, can be taken over: a link opened in a chat app's own browser and
 * then again in the phone's browser must not lock the person out.
 */

import type { CaseLiveSide } from "@/lib/case-types";
import { partiesFor } from "@/lib/multi";
import { caseDb, respondentOf, type CaseBundle, type CaseRow, type InviteRow, type SeatRow } from "./db";
import { claimMatches, newInviteNonce, respondentClaim } from "./invite";

/** A heartbeat counts as "typing" for this long. */
export const TYPING_MS = 6000;
export const SEAT_IDLE_MS = 30 * 60 * 1000;

type Invited = "b" | "c" | "d";

const invitedParties = (row: CaseRow): Invited[] => partiesFor(row.sides).slice(1) as Invited[];

export function seatClaim(row: Pick<CaseRow, "id">, seat: Pick<SeatRow, "nonce">): string | null {
  return respondentClaim(row.id, seat.nonce);
}

export function liveSides(
  c: { row: CaseRow; sides: readonly { party: string }[]; seats: readonly SeatRow[] },
  now: Date,
): CaseLiveSide[] {
  return invitedParties(c.row).map((party) => {
    if (c.sides.some((s) => s.party === party)) return { party, state: "answered" as const };
    const seat = c.seats.find((s) => s.party === party);
    if (!seat) return { party, state: "waiting" as const };
    const typing = seat.typingAt !== null && now.getTime() - Date.parse(seat.typingAt) < TYPING_MS;
    return { party, state: typing ? ("typing" as const) : ("opened" as const) };
  });
}

/** The side this request already holds: through its seat or its answer, by
 * account or by claim secret. Never the owner. */
export function heldSide(
  row: CaseRow,
  invites: readonly InviteRow[],
  seats: readonly SeatRow[],
  viewerId: string | null,
  claim: string | null,
): Invited | null {
  if (viewerId !== null && viewerId === row.ownerId) return null;
  for (const party of invitedParties(row)) {
    const seat = seats.find((s) => s.party === party);
    if (seat) {
      if (viewerId !== null && seat.userId === viewerId) return party;
      if (claimMatches({ id: row.id, respondentClaimNonce: seat.nonce }, claim)) return party;
    }
    const who = respondentOf(row, invites, party);
    if (viewerId !== null && who.userId === viewerId) return party;
    if (claimMatches({ id: row.id, respondentClaimNonce: who.claimNonce }, claim)) return party;
  }
  return null;
}

const idle = (seat: SeatRow, now: Date) =>
  seat.userId === null && now.getTime() - Date.parse(seat.typingAt ?? seat.openedAt) > SEAT_IDLE_MS;

/** The side the next opener would get, or null when the case is full. */
export function nextOpenSide(bundle: CaseBundle, now: Date): Invited | null {
  const { row, invites, seats, sides } = bundle;
  for (const party of invitedParties(row)) {
    if (sides.some((s) => s.party === party)) continue;
    if (respondentOf(row, invites, party).claimNonce !== null) continue;
    const seat = seats.find((s) => s.party === party);
    if (!seat || idle(seat, now)) return party;
  }
  return null;
}

/**
 * Takes the next open side for whoever holds `viewerId` (null when signed
 * out). Returns the seat, or null when every side is taken. The owner never
 * takes one; callers check that first.
 */
export async function claimSeat(bundle: CaseBundle, viewerId: string | null, now: Date): Promise<SeatRow | null> {
  const db = await caseDb();
  const { row, invites, seats, sides } = bundle;
  const nowIso = now.toISOString();
  for (const party of invitedParties(row)) {
    if (sides.some((s) => s.party === party)) continue;
    if (respondentOf(row, invites, party).claimNonce !== null) continue;
    const seat = seats.find((s) => s.party === party);
    const nonce = newInviteNonce();
    const open =
      `EXISTS (SELECT 1 FROM cases WHERE id = ? AND status = 'awaiting_respondent' AND expires_at > ? AND removed_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM case_sides WHERE case_id = ? AND party = ?)`;
    const openArgs = [row.id, nowIso, row.id, party];
    const bound = viewerId ? " AND NOT EXISTS (SELECT 1 FROM case_seats WHERE case_id = ? AND user_id = ?)" : "";
    const boundArgs = viewerId ? [row.id, viewerId] : [];
    let won = false;
    if (!seat) {
      const rs = await db.execute({
        sql: `INSERT INTO case_seats (case_id, party, nonce, user_id, opened_at)
              SELECT ?, ?, ?, ?, ? WHERE ${open}${bound}
              ON CONFLICT DO NOTHING`,
        args: [row.id, party, nonce, viewerId, nowIso, ...openArgs, ...boundArgs],
      });
      won = rs.rowsAffected === 1;
    } else if (idle(seat, now)) {
      const rs = await db.execute({
        sql: `UPDATE case_seats SET nonce = ?, user_id = ?, opened_at = ?, typing_at = NULL
              WHERE case_id = ? AND party = ? AND nonce = ? AND user_id IS NULL AND ${open}${bound}`,
        args: [nonce, viewerId, nowIso, row.id, party, seat.nonce, ...openArgs, ...boundArgs],
      });
      won = rs.rowsAffected === 1;
    }
    if (won) return { caseId: row.id, party, nonce, userId: viewerId, openedAt: nowIso, typingAt: null };
    // A signed-in person who already holds a seat is found before this runs;
    // losing the insert to a concurrent opener just means the next side.
  }
  return null;
}

/** Gives a seat back (an answer that failed right after it was taken). */
export async function releaseSeat(seat: SeatRow): Promise<void> {
  const db = await caseDb();
  await db.execute({
    sql: "DELETE FROM case_seats WHERE case_id = ? AND party = ? AND nonce = ?",
    args: [seat.caseId, seat.party, seat.nonce],
  });
}

/** Notes that the holder of `party` is typing; touches nothing once they answered. */
export async function recordTyping(caseId: string, party: Invited, now: Date): Promise<void> {
  const db = await caseDb();
  const nowIso = now.toISOString();
  await db.execute({
    sql: `UPDATE case_seats SET typing_at = ?
          WHERE case_id = ? AND party = ?
            AND NOT EXISTS (SELECT 1 FROM case_sides WHERE case_id = ? AND party = ?)`,
    args: [nowIso, caseId, party, caseId, party],
  });
}
