import type { FinalVerdict, JudgeVerdict, MultiVote, PartyId, VerdictResult } from "./types";

/** Shared pure helpers for a dispute with three or four sides. Two-sided
 * verdicts never go through here. */

export const PARTY_IDS: readonly PartyId[] = ["a", "b", "c", "d"];

/** The first `count` sides, A to D. */
export function partiesFor(count: number): PartyId[] {
  return PARTY_IDS.slice(0, Math.max(2, Math.min(4, count)));
}

export const partyLabel = (id: PartyId): string => `Party ${id.toUpperCase()}`;

/** The side a verdict names as the winner, or null (too close, split,
 * conditional, dissolved, a refusal). Works on every verdict: a three- or
 * four-sided one carries it in `winner`, a two-sided one in `verdict`. */
export function winnerOf(r: Pick<VerdictResult, "verdict" | "winner" | "parties">): PartyId | null {
  if (r.parties) return r.winner ?? null;
  return r.verdict === "side_a" ? "a" : r.verdict === "side_b" ? "b" : null;
}

/** What older readers see in `verdict`: side_a or side_b only when that side
 * really won, otherwise too_close. */
export function legacyVerdict(winner: PartyId | null): FinalVerdict {
  return winner === "a" ? "side_a" : winner === "b" ? "side_b" : "too_close";
}

/** What older readers see in `runs` for one run: side_a or side_b, and
 * "split" (a value they draw as a run that named neither) for the rest. */
export function legacyRun(vote: MultiVote): JudgeVerdict {
  return vote === "a" ? "side_a" : vote === "b" ? "side_b" : "split";
}

/** The reading order for judge seat `seat`: the sides rotated so each seat
 * starts from a different one. Seat 0 reads them in order. */
export function readingOrder(parties: readonly PartyId[], seat: number): PartyId[] {
  const n = parties.length;
  const shift = ((seat % n) + n) % n;
  return [...parties.slice(shift), ...parties.slice(0, shift)];
}

/** One typed side of the request, as the judges' document holds it. */
export type SideText = { party: PartyId; text: string };

/** The anonymized accounts of a three- or four-sided dispute, kept apart
 * and labelled. The case document the judges read. */
export function composeSides(sides: readonly SideText[]): string {
  return sides
    .map((s) => `${partyLabel(s.party).toUpperCase()}'S SIDE:\n${s.text}`)
    .join("\n\n");
}
