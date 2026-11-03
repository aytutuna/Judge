import { t, type Lang } from "./i18n";

/** Longest argument the form accepts (the API enforces the same cap). */
export const MAX_ARGUMENT = 6000;

/** The "Try an example" cases; each has a name and a text for both sides. */
export const EXAMPLES = ["dishwasher", "bill", "thermostat", "roadTrip", "seat", "spoiler", "jacket", "lastSlice"] as const;

export type SideInput = { text: string; name: string };

/** What the judges read. Without the other side it is the first text as
 * written; with it, both sides joined with a name (or a label) in front. */
export function joinSides(lang: Lang, mine: SideInput, theirs: SideInput): string {
  const other = theirs.text.trim();
  if (!other) return mine.text;
  const part = (text: string, name: string, unnamed: "home.mySide" | "home.otherSide") =>
    `${name.trim() ? t(lang, "home.says", { name: name.trim() }) : t(lang, unnamed)} ${text}`;
  const own = mine.text.trim();
  const parts = own ? [part(own, mine.name, "home.mySide")] : [];
  parts.push(part(other, theirs.name, "home.otherSide"));
  return parts.join("\n\n");
}
