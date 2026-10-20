/**
 * Small typographic helpers for display text. Pure, no React.
 */

const NBSP = " ";

/**
 * Keep the last word of a short heading off a line of its own by turning
 * the final run of whitespace into one non-breaking space. Only applies to
 * headings of three to `maxWords` words (default 6). Longer text is left to
 * `text-wrap: balance`, where a forced pair could overflow narrow screens;
 * so are two-word headings, where binding the only space would make the
 * whole heading one unbreakable token ("Settle hakkında" at 320px).
 */
export function noOrphan(text: string, maxWords = 6): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3 || words.length > maxWords) return text;
  return text.replace(/\s+(?=\S+\s*$)/, NBSP);
}

/**
 * Split a "phrase · phrase" line into phrases that can each be kept whole
 * (white-space: nowrap), with the separator bound to the end of the phrase
 * before it. A narrow line then breaks after the dot, never inside a phrase
 * or before the dot.
 */
export function separatorPhrases(text: string, separator = " · "): string[] {
  const parts = text.split(separator);
  const dot = separator.trim();
  return parts.map((p, i) => (i < parts.length - 1 ? `${p}${NBSP}${dot}` : p));
}

/**
 * Leading emoji (with variation selectors, skin tones, ZWJ sequences and
 * keycaps) plus a check mark, and the whitespace after them. Digits and
 * letters are never matched, even though some are technically emoji.
 */
const LEADING_EMOJI =
  /^(?:[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}✓️‍⃣])+\s*/u;

/**
 * Drop a decorative leading emoji from a dictionary string ("⚡ The crux"
 * becomes "The crux") where the new design draws its own icon instead.
 * Strings without one come back unchanged.
 */
export function stripLeadingEmoji(text: string): string {
  return text.replace(LEADING_EMOJI, "");
}

/** One piece of a headline: `keep` marks a hyphenated word to hold together. */
export type HyphenRun = { text: string; keep: boolean };

/**
 * Split text so that each short hyphenated word ("soggy-crust",
 * "kendi-kendine") can be kept whole (white-space: nowrap). Browsers break
 * after a hard hyphen no matter what `hyphens` says, which leaves
 * "soggy-" at the end of one line and "crust" on the next. Words longer than
 * `maxLen` stay breakable so they can never overflow a narrow card. The real
 * hyphen is kept, so copying and searching the text still work. Joining the
 * runs gives back the input.
 */
export function hyphenRuns(text: string, maxLen = 24): HyphenRun[] {
  const runs: HyphenRun[] = [];
  const word = /\S*\p{L}[-‐]\p{L}\S*/gu;
  let last = 0;
  for (const m of text.matchAll(word)) {
    if (m[0].length > maxLen) continue;
    const at = m.index ?? 0;
    if (at > last) runs.push({ text: text.slice(last, at), keep: false });
    runs.push({ text: m[0], keep: true });
    last = at + m[0].length;
  }
  if (last < text.length || runs.length === 0) runs.push({ text: text.slice(last), keep: false });
  return runs;
}
