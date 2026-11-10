import { t, type Lang } from "./i18n";
import { partyLabel } from "./names";

/** Longest argument the form accepts (the API enforces the same cap). */
export const MAX_ARGUMENT = 6000;

/** The "Try an example" cases; each has a name and a text for both sides. */
export const EXAMPLES = ["dishwasher", "bill", "thermostat", "roadTrip", "seat", "spoiler", "jacket", "lastSlice"] as const;

/** A link needs a side worth judging, or none at all; a few words or only images do not count. */
export function inviteTextOk(text: string, images: number): boolean {
  const len = text.trim().length;
  return len ? len >= 20 : images === 0;
}

export type SideInput = { text: string; name: string };

/** What the judges read. Without the other side it is the first text as
 * written; with it, both sides joined with a name (or a label) in front.
 * `more` holds sides C and D. */
export function joinSides(lang: Lang, mine: SideInput, theirs: SideInput, more: readonly SideInput[] = []): string {
  const other = theirs.text.trim();
  if (!other) return mine.text;
  const part = (text: string, name: string, unnamed: string) =>
    `${name.trim() ? t(lang, "home.says", { name: name.trim() }) : unnamed} ${text}`;
  const own = mine.text.trim();
  const parts = own ? [part(own, mine.name, t(lang, "home.mySide"))] : [];
  parts.push(part(other, theirs.name, t(lang, "home.otherSide")));
  more.forEach((side, i) => {
    const text = side.text.trim();
    if (text) parts.push(part(text, side.name, `${partyLabel(lang, i ? "d" : "c")}:`));
  });
  return parts.join("\n\n");
}

/** Every side of a form with more than two, as typed: the judges read them
 * one by one, so each needs a side worth judging. */
export function manySidesOk(sides: readonly SideInput[]): boolean {
  return sides.every((s) => s.text.trim().length >= 20);
}
