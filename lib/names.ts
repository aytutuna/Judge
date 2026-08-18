import type { NameMapping } from "./types";

/**
 * Derive display names for the two parties from the anonymization map.
 * Free text keeps "Party A/B" (rewriting it would break grammar); only the
 * visual labels get personalized. First-person narrators become "You".
 */
export function partyNames(nameMap: NameMapping[] | undefined): {
  nameA: string;
  nameB: string;
} {
  let nameA = "Party A";
  let nameB = "Party B";
  for (const m of nameMap ?? []) {
    const original = /^(i|me|my|myself)$/i.test(m.original.trim())
      ? "You"
      : m.original.trim();
    if (/^party a$/i.test(m.replacement.trim())) nameA = original;
    if (/^party b$/i.test(m.replacement.trim())) nameB = original;
  }
  return { nameA, nameB };
}
