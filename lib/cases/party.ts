import type { PartyLetter } from "@/lib/case-types";
import { respondentOf, type CaseRow, type InviteRow } from "./db";
import { claimMatches } from "./invite";

/** Whether this request proves it comes from side `party` (not A): the
 * account bound to that side, or the claim secret from answering it. Never
 * the owner. */
export function provenParty(
  row: CaseRow,
  invites: readonly InviteRow[],
  party: PartyLetter,
  viewerId: string | null,
  claim: string | null,
): boolean {
  if (party === "a" || row.mode !== "two_sided" || (viewerId !== null && viewerId === row.ownerId)) return false;
  const who = respondentOf(row, invites, party);
  if (who.userId && viewerId === who.userId) return true;
  return claimMatches({ id: row.id, respondentClaimNonce: who.claimNonce }, claim);
}

/** Which side of the case the request is: A for the owner, else the side it
 * proves (B before C before D), else null. */
export function partyOfViewer(
  row: CaseRow,
  invites: readonly InviteRow[],
  viewerId: string | null,
  claim: string | null,
): PartyLetter | null {
  if (viewerId !== null && viewerId === row.ownerId) return "a";
  for (const party of ["b", "c", "d"] as const) {
    if (provenParty(row, invites, party, viewerId, claim)) return party;
  }
  return null;
}
