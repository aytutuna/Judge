/**
 * Which face a crux is set in. Instrument Serif is a condensed display face:
 * lovely for a one-line crux, cramped across a paragraph. Real cruxes run
 * much longer than the sample, so past a length threshold the crux falls
 * back to the body face. Pure, no React.
 */

/** Longest crux, in characters, that is still set in the display serif. */
export const CRUX_SERIF_MAX = 180;

export type CruxStyle = "serif" | "sans";

/** Counts code points of the whitespace-collapsed text, so line breaks,
 * double spaces and astral characters do not tip the choice. */
export function cruxStyle(text: string): CruxStyle {
  const length = [...text.replace(/\s+/g, " ").trim()].length;
  return length > CRUX_SERIF_MAX ? "sans" : "serif";
}
