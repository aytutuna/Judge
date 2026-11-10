/**
 * A case party's own originals, decrypted for that party's requests only.
 * Server only.
 */

import type { PartyLetter as CaseParty } from "@/lib/case-types";
import type { CaseRow } from "@/lib/cases/db";
import { mergeNameMaps, type CaseOriginalEntry, type OriginalPayload } from "@/lib/originals-types";
import type { NameMapping } from "@/lib/types";
import { aad, openOrNull } from "./crypto";
import { getOriginal, subjects } from "./db";
import { openCaseDisplayName } from "./display";

async function entry(subject: string, removed: boolean): Promise<CaseOriginalEntry | null> {
  const row = await getOriginal(subject);
  if (!row) return removed ? { status: "removed", original: null } : null;
  if (!row.sealed) return { status: row.removedAt || removed ? "removed" : "not_stored", original: null };
  const original = openOrNull<OriginalPayload>(row.sealed, aad.original(subject), subject);
  return original ? { status: "stored", original } : { status: "unreadable", original: null };
}

export type PartyOriginals = {
  side: CaseOriginalEntry;
  /** Null when the party has no appeal original. */
  appeal: CaseOriginalEntry | null;
  /** Side and appeal maps merged; null when neither is readable. */
  names: NameMapping[] | null;
};

export async function partyOriginals(row: CaseRow, party: CaseParty): Promise<PartyOriginals> {
  const removed = Boolean({ a: row.removedAAt, b: row.removedBAt, c: row.removedCAt, d: row.removedDAt }[party]);
  const [side, appeal] = await Promise.all([
    entry(subjects.side(row.id, party), removed),
    entry(subjects.appeal(row.id, party), removed),
  ]);
  const maps = [side?.original?.nameMap, appeal?.original?.nameMap].filter((m): m is NameMapping[] => Array.isArray(m));
  return {
    side: side ?? { status: "not_stored", original: null },
    appeal,
    names: maps.length ? maps.reduce<NameMapping[]>((acc, m) => mergeNameMaps(acc, m), []) : null,
  };
}

/** The display names one viewer of a case may see: nothing for someone who
 * has not proven they are a party; for a party, their own name, plus the
 * other party's only while names are on (what the share page shows). */
export function caseDisplayNames(
  row: CaseRow,
  party: CaseParty,
  proven: boolean,
): { a: string | null; b: string | null; c?: string | null; d?: string | null } {
  if (!proven) return { a: null, b: null };
  const name = (p: CaseParty) => (p === party ? openCaseDisplayName(row, p) : row.namesVisible ? openCaseDisplayName(row, p) : null);
  return {
    a: name("a"),
    b: name("b"),
    ...(row.sides > 2 ? { c: name("c"), ...(row.sides > 3 ? { d: name("d") } : {}) } : {}),
  };
}
