/**
 * What the judges read for a case: the composed, anonymized document (also
 * stored as the verdict's `input`) and the evidence groups for the EVIDENCE
 * block. Pure.
 */

import type { CaseMode, PartyLetter } from "@/lib/case-types";
import type { EvidenceGroup, VerifiedEvidence } from "@/lib/evidence";
import { composeSides, partiesFor } from "@/lib/multi";
import type { AppealRow, CaseBundle, EvidenceRow, SideRow } from "./db";

const LABEL: Record<PartyLetter, string> = { a: "Party A", b: "Party B", c: "Party C", d: "Party D" };
const LETTER: Record<PartyLetter, string> = { a: "A", b: "B", c: "C", d: "D" };
const other = (p: PartyLetter): PartyLetter => (p === "a" ? "b" : "a");

/** What composing reads of a side and an appeal (one-sided verdicts reuse it). */
type Account = Pick<SideRow, "party" | "text">;
type Context = Pick<AppealRow, "id" | "party" | "text">;

/** Two accounts, labelled and kept apart. With no side B (a one-sided
 * case) the document is side A's text exactly, like a premium argument. */
export function composeCaseDocument(sideA: string, sideB: string | null): string {
  if (sideB === null) return sideA;
  return [
    "PARTY A'S ACCOUNT (written by Party A, without seeing Party B's):",
    sideA,
    "",
    "PARTY B'S ACCOUNT (written by Party B, without seeing Party A's):",
    sideB,
  ].join("\n");
}

/** One added-context section. `isNew` marks the appeal being judged now. */
export function appealSection(party: PartyLetter, text: string, mode: CaseMode, isNew: boolean, count = 2): string {
  const by = LABEL[party];
  const heading =
    mode === "two_sided" && count > 2
      ? isNew
        ? `NEW CONTEXT FROM ${by.toUpperCase()} (added after an earlier verdict; ${by} had seen that verdict and the other accounts; the other parties have not answered it):`
        : `CONTEXT ADDED EARLIER BY ${by.toUpperCase()} (after an earlier verdict, already judged once):`
      : mode === "two_sided"
      ? isNew
        ? `NEW CONTEXT FROM ${by.toUpperCase()} (added after an earlier verdict; ${by} had seen that verdict and ${LABEL[other(party)]}'s account; ${LABEL[other(party)]} has not answered it):`
        : `CONTEXT ADDED EARLIER BY ${by.toUpperCase()} (after an earlier verdict, already judged once):`
      : isNew
        ? `NEW CONTEXT FROM ${by.toUpperCase()} (added after an earlier verdict, which ${by} had seen):`
        : `CONTEXT ADDED EARLIER BY ${by.toUpperCase()} (after an earlier verdict, already judged once):`;
  return `${heading}\n${text}`;
}

export function sideText(sides: readonly Account[], party: PartyLetter): string | null {
  return sides.find((s) => s.party === party)?.text ?? null;
}

/** Sides that were invited and never answered: the owner went ahead without
 * them. Their labels can still appear in the accounts that were written. */
export function missingSides(bundle: Pick<CaseBundle, "sides" | "invites">): PartyLetter[] {
  return bundle.invites.map((i) => i.party).filter((p) => !bundle.sides.some((s) => s.party === p));
}

/** The case document for a judging run: both accounts (or side A alone),
 * then a note on any side that did not answer, then earlier judged appeals
 * oldest first, then the appeal being judged. */
export function composeForJudging(
  sides: readonly Account[],
  mode: CaseMode,
  appeals: { earlier: readonly Context[]; current: Context | null },
  count = 2,
  missing: readonly PartyLetter[] = [],
): string {
  const many = mode === "two_sided" && count > 2;
  const base = many
    ? composeSides(partiesFor(count).flatMap((party) => sides.filter((s) => s.party === party)))
    : composeCaseDocument(sideText(sides, "a") ?? "", mode === "two_sided" ? sideText(sides, "b") ?? "" : null);
  const parts = [base];
  if (mode === "two_sided" && missing.length > 0) {
    parts.push(
      `NOT HEARD: invited but did not answer: ${missing.map((p) => LABEL[p]).join(", ")}. They are not part of this dispute; treat what the accounts above say about them only as those accounts' claims.`,
    );
  }
  for (const a of appeals.earlier) parts.push(appealSection(a.party, a.text, mode, false, count));
  if (appeals.current) parts.push(appealSection(appeals.current.party, appeals.current.text, mode, true, count));
  return parts.join("\n\n");
}

const toVerified = (rows: readonly EvidenceRow[]): VerifiedEvidence[] =>
  [...rows].sort((x, y) => x.seq - y.seq).map((r) => ({ kind: r.kind, transcript: r.transcript }));

/**
 * Evidence groups for the judges: each side's images ("A1", "B1"; "E1" on a
 * one-sided case), earlier judged appeals ("A-ctx1") and the appeal being
 * judged ("A-new1"). Empty groups are left out.
 */
export function evidenceGroups(
  evidence: readonly EvidenceRow[],
  mode: CaseMode,
  appeals: { earlier: readonly Context[]; current: Context | null },
  count = 2,
): EvidenceGroup[] {
  const groups: EvidenceGroup[] = [];
  const push = (party: PartyLetter, prefix: string, rows: EvidenceRow[]) => {
    if (rows.length === 0) return;
    groups.push(
      mode === "two_sided"
        ? { party, idPrefix: `${LETTER[party]}${prefix}`, items: toVerified(rows) }
        : { party: null, idPrefix: `E${prefix}`, items: toVerified(rows) },
    );
  };
  const sideParties: PartyLetter[] = mode === "two_sided" ? partiesFor(count) : ["a"];
  for (const p of sideParties) push(p, "", evidence.filter((e) => e.party === p && e.appealId === null));
  for (const a of appeals.earlier) push(a.party, "-ctx", evidence.filter((e) => e.appealId === a.id));
  if (appeals.current) {
    const id = appeals.current.id;
    push(appeals.current.party, "-new", evidence.filter((e) => e.appealId === id));
  }
  return groups;
}

/** Image counts per party for `evidence_used` (sides plus the appeals counted). */
export function evidenceCounts(
  evidence: readonly EvidenceRow[],
  appealIds: ReadonlySet<string>,
  count = 2,
): { a: number; b: number; c?: number; d?: number } {
  const counted = evidence.filter((e) => e.appealId === null || appealIds.has(e.appealId));
  const per = (party: PartyLetter) => counted.filter((e) => e.party === party).length;
  return {
    a: per("a"),
    b: per("b"),
    ...(count > 2 ? { c: per("c") } : {}),
    ...(count > 3 ? { d: per("d") } : {}),
  };
}
