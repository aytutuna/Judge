import { contentLang, type Lang } from "./i18n";
import type { VerdictResult } from "./types";

/**
 * Language a verdict's free text is written in. New rows record it; rows
 * stored before that fall back to the letter/label heuristic over several
 * fields (more text than the OG image's headline + crux, so a short
 * Turkish headline without Turkish-only letters still reads as Turkish).
 * Pure: safe on the server and in the browser.
 */
export function verdictLang(result: VerdictResult): Lang {
  if (result.lang) return result.lang;
  const map = result.argument_map;
  return contentLang(
    [
      result.headline,
      result.crux,
      result.losing_side_best_point,
      map.bedrock_a,
      map.bedrock_b,
      ...map.side_a.map((c) => c.claim),
      ...map.side_b.map((c) => c.claim),
    ].join(" "),
  );
}
