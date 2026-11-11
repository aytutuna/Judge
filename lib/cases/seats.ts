/**
 * One link per case. Opening it takes the next open side, B then C then D, in
 * a row of case_seats; the insert is the atomic step, so two people opening at
 * once land on different sides. The seat's nonce becomes the claim secret
 * (the same value before and after the answer), so the person is found again
 * by that secret or by their account.
 *
 * A seat that no request has touched for SEAT_IDLE_MS, with no account behind
 * it, can be taken over once no free side is left: a link opened in a chat
 * app's own browser and then again in the phone's browser must not lock the
 * person out. Any request carrying the seat's claim counts as a touch.
 *
 * A side that still has an unused per-side link from before the shared link
 * (case_invites.legacy) is not handed out here; that link's holder gets it.
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
  seat.userId === null && Date.parse(seat.seenAt ?? seat.openedAt) < now.getTime() - SEAT_IDLE_MS;

/** The sides a new opener could take, best first: free ones, then idle
 * seats. `only` limits it to one side (an opener of that side's own link). */
function openSides(bundle: CaseBundle, now: Date, only?: Invited): { party: Invited; seat?: SeatRow }[] {
  const { row, invites, seats, sides } = bundle;
  const free: { party: Invited }[] = [];
  const stale: { party: Invited; seat: SeatRow }[] = [];
  for (const party of invitedParties(row)) {
    if (only && party !== only) continue;
    if (sides.some((s) => s.party === party)) continue;
    if (respondentOf(row, invites, party).claimNonce !== null) continue;
    const reserved = invites.some((i) => i.party === party && i.legacy && i.answeredAt === null && i.claimNonce === null);
    if (reserved && !only) continue;
    const seat = seats.find((s) => s.party === party);
    if (!seat) free.push({ party });
    else if (idle(seat, now)) stale.push({ party, seat });
  }
  return [...free, ...stale];
}

/** The side the next opener would get, or null when the case is full. */
export function nextOpenSide(bundle: CaseBundle, now: Date): Invited | null {
  return openSides(bundle, now)[0]?.party ?? null;
}

/**
 * Takes the next open side for whoever holds `viewerId` (null when signed
 * out). Returns the seat, or null when every side is taken. The owner never
 * takes one; callers check that first. `only` is the side of an older
 * per-side link, the one side that link may take.
 */
export async function claimSeat(
  bundle: CaseBundle,
  viewerId: string | null,
  now: Date,
  only?: Invited,
): Promise<SeatRow | null> {
  const db = await caseDb();
  const { row } = bundle;
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - SEAT_IDLE_MS).toISOString();
  for (const { party, seat } of openSides(bundle, now, only)) {
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
        sql: `INSERT INTO case_seats (case_id, party, nonce, user_id, opened_at, seen_at)
              SELECT ?, ?, ?, ?, ?, ? WHERE ${open}${bound}
              ON CONFLICT DO NOTHING`,
        args: [row.id, party, nonce, viewerId, nowIso, nowIso, ...openArgs, ...boundArgs],
      });
      won = rs.rowsAffected === 1;
    } else {
      // Idleness is checked again here: a heartbeat may have landed since the read.
      const rs = await db.execute({
        sql: `UPDATE case_seats SET nonce = ?, user_id = ?, opened_at = ?, seen_at = ?, typing_at = NULL
              WHERE case_id = ? AND party = ? AND nonce = ? AND user_id IS NULL
                AND COALESCE(seen_at, opened_at) < ? AND ${open}${bound}`,
        args: [nonce, viewerId, nowIso, nowIso, row.id, party, seat.nonce, cutoff, ...openArgs, ...boundArgs],
      });
      won = rs.rowsAffected === 1;
    }
    if (won) return { caseId: row.id, party, nonce, userId: viewerId, openedAt: nowIso, typingAt: null, seenAt: nowIso };
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
    sql: `UPDATE case_seats SET typing_at = ?, seen_at = ?
          WHERE case_id = ? AND party = ?
            AND NOT EXISTS (SELECT 1 FROM case_sides WHERE case_id = ? AND party = ?)`,
    args: [nowIso, nowIso, caseId, party, caseId, party],
  });
}

/** Keeps the seat of `party` from looking idle; any request that proved the claim calls it. */
export async function touchSeat(caseId: string, party: Invited, now: Date): Promise<void> {
  const db = await caseDb();
  await db.execute({
    sql: "UPDATE case_seats SET seen_at = ? WHERE case_id = ? AND party = ?",
    args: [now.toISOString(), caseId, party],
  });
}
