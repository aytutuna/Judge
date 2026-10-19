import { t, type Lang } from "./i18n";
import type { NameMapping } from "./types";

/**
 * Turkish first-person forms. Matched with toLocaleLowerCase("tr") — never a
 * case-insensitive regex (JS simple case folding excludes U+0130, so /benim/i
 * misses an all-caps "BENİM") and never a case-sensitive lowercase match (the
 * anonymizer reports a genuine narrator's sentence-initial "Ben" capitalized).
 */
const TR_SELF = new Set(["ben", "benim", "bana", "beni", "kendim"]);

const EN_SELF = /^(i|me|my|myself)$/i;

/**
 * Derive display names for the two parties from the anonymization map.
 * Free text keeps "Party A/B" (rewriting it would break grammar); only the
 * visual labels get personalized. First-person narrators become You/Sen.
 *
 * The self flags are the STRUCTURAL trigger for second-person grammar —
 * never detect "you" by string-comparing display names (the tr name is
 * "Sen", and default-locale toLowerCase mangles İ in real names like
 * "İrem").
 *
 * The pronoun→You/Sen mapping applies ONLY to the Party A slot: the
 * anonymizer's own contract says a first-person narrator is always Party A,
 * which protects a friend actually named "Ben" (a top-100 English name) who
 * lands in slot B. The Turkish set additionally applies only when the
 * argument was written in Turkish, so an English session about Ben never
 * becomes "You".
 *
 * `lang` is the display language of the labels; `selfLang` is the language
 * the argument was judged in (defaults to `lang`). They differ when a
 * verdict is shown translated: a Turkish "Ben" stays the narrator, labelled
 * "You", after the page switches to English.
 */
export function partyNames(
  nameMap: NameMapping[] | undefined,
  lang: Lang = "en",
  selfLang: Lang = lang,
): { nameA: string; nameB: string; aIsSelf: boolean; bIsSelf: boolean } {
  let nameA = t(lang, "party.a");
  let nameB = t(lang, "party.b");
  let aIsSelf = false;
  // Always false under the current anonymizer contract (a first-person
  // narrator is always Party A); kept so call sites stay uniform
  // (`p.party === "a" ? aIsSelf : bIsSelf`).
  const bIsSelf = false;
  for (const m of nameMap ?? []) {
    const original = m.original.trim();
    if (/^party a$/i.test(m.replacement.trim())) {
      const self =
        EN_SELF.test(original) ||
        (selfLang === "tr" && TR_SELF.has(original.toLocaleLowerCase("tr")));
      if (self) {
        nameA = t(lang, "you");
        aIsSelf = true;
      } else {
        nameA = original;
      }
    }
    if (/^party b$/i.test(m.replacement.trim())) nameB = original;
  }
  return { nameA, nameB, aIsSelf, bIsSelf };
}
