import type { EvidenceGroup, VerifiedEvidence } from "./types";

const SIDES = ["a", "b", "c", "d"] as const;

/**
 * The evidence groups of a verdict the writer typed: `perSide` holds the
 * images each side's box carried, side A first. Images of side A alone read as
 * those of the person asking; once any other side has images, each side with
 * images gets its own group (A1, B1, C1, D1). Pure.
 */
export function sideEvidenceGroups(perSide: readonly (readonly VerifiedEvidence[])[]): EvidenceGroup[] {
  const used = perSide.flatMap((items, i) => (items.length ? [{ items: [...items], i }] : []));
  if (used.length === 1 && used[0].i === 0) return [{ party: null, idPrefix: "E", items: used[0].items }];
  return used.map(({ items, i }) => ({ party: SIDES[i], idPrefix: SIDES[i].toUpperCase(), items }));
}
