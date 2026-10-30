import { EMAIL_EN } from "../email";
import { COUNT_KEYS, COUNTS_FROM_ONE, EN, type CountKey, type Key, type Locale } from "../i18n";
import { langTag, PARTY_LABELS, type Lang } from "../langs";

const placeholders = (s: string) => [...new Set(s.match(/\{[A-Za-z]+\}/g) ?? [])].sort().join(" ");

/** Slots a translation may add because the caller fills them anyway (Turkish
 * says "{n} ... yargıcı" where English spells out "1"). */
const OPTIONAL_SLOTS: Partial<Record<Key, string>> = { "judgesVoted.one": "{n}" };

function sameSlots(key: Key, translated: string): boolean {
  const extra = OPTIONAL_SLOTS[key];
  const theirs = extra ? translated.split(extra).join("") : translated;
  return placeholders(theirs) === placeholders(EN[key]);
}

/** The plural categories a count string needs besides "other": the ones the
 * language uses up to 1000, from 2 for a key whose caller handles 1 with a
 * key of its own, from 1 for the rest (COUNTS_FROM_ONE). */
export function requiredPluralForms(lang: Lang, key?: CountKey): Intl.LDMLPluralRule[] {
  const rules = new Intl.PluralRules(langTag(lang));
  const seen = new Set<Intl.LDMLPluralRule>();
  const from = key && (COUNTS_FROM_ONE as readonly CountKey[]).includes(key) ? 1 : 2;
  for (let n = from; n <= 1000; n++) seen.add(rules.select(n));
  seen.delete("other");
  return [...seen];
}

/** A category that stands for one number only (Arabic "two", English "one"),
 * where the form may spell the number out instead of using {n}. */
function isExact(lang: Lang, category: string): boolean {
  const rules = new Intl.PluralRules(langTag(lang));
  let hits = 0;
  for (let n = 0; n <= 1000; n++) if (rules.select(n) === category) hits++;
  return hits === 1;
}

/**
 * Everything wrong with a locale file, one line each; empty when it is fine.
 * Same keys as English (the privacy and terms pages' each all or none), the same {slots}
 * in every string and plural form (an exact-number form may drop {n}), nothing empty, plural forms only in
 * categories the language has and every one it needs, party labels that are
 * listed in PARTY_LABELS and named in the voice note, and complete email
 * copy.
 */
export function checkLocale(lang: Lang, locale: Locale): string[] {
  const problems: string[] = [];
  const strings = locale.strings as Partial<Record<string, unknown>>;
  const keys = Object.keys(EN) as Key[];

  const translated = new Set<string>();
  for (const page of ["privacy", "terms"]) {
    const legal = keys.filter((k) => k.startsWith(`${page}.`));
    const count = legal.filter((k) => strings[k] !== undefined).length;
    if (count > 0) translated.add(page);
    if (count > 0 && count < legal.length) {
      problems.push(`${page} page is partly translated (${count} of ${legal.length} ${page}.* strings): give all or none`);
    }
  }

  for (const key of keys) {
    const value = strings[key];
    if (value === undefined) {
      const page = key.split(".")[0];
      if ((page !== "privacy" && page !== "terms") || translated.has(page)) problems.push(`${key}: missing`);
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      problems.push(`${key}: empty`);
      continue;
    }
    if (!sameSlots(key, value)) {
      problems.push(`${key}: slots ${placeholders(value) || "(none)"} but English has ${placeholders(EN[key]) || "(none)"}`);
    }
  }
  for (const key of Object.keys(strings)) {
    if (!(key in EN)) problems.push(`${key}: not an English key`);
  }

  const categories = new Intl.PluralRules(langTag(lang)).resolvedOptions().pluralCategories;
  const plurals = (locale.plurals ?? {}) as Partial<Record<string, Partial<Record<string, unknown>>>>;
  for (const [key, forms] of Object.entries(plurals)) {
    if (!(COUNT_KEYS as readonly string[]).includes(key)) {
      problems.push(`plurals.${key}: not a count string (see COUNT_KEYS)`);
      continue;
    }
    for (const [category, form] of Object.entries(forms ?? {})) {
      if (category === "other" || !(categories as string[]).includes(category)) {
        problems.push(`plurals.${key}.${category}: ${lang} has no such form (its forms: ${categories.filter((c) => c !== "other").join(", ") || "none"})`);
      } else if (typeof form !== "string" || !form.trim()) {
        problems.push(`plurals.${key}.${category}: empty`);
      } else if (
        placeholders(form) !== placeholders(EN[key as CountKey]) &&
        !(isExact(lang, category) && placeholders(form) === placeholders(EN[key as CountKey].split("{n}").join("")))
      ) {
        problems.push(`plurals.${key}.${category}: slots ${placeholders(form) || "(none)"} but English has ${placeholders(EN[key as CountKey])}`);
      }
    }
  }
  for (const key of COUNT_KEYS) {
    for (const category of requiredPluralForms(lang, key)) {
      if (plurals[key]?.[category] === undefined) problems.push(`plurals.${key}.${category}: missing`);
    }
  }

  const voice = typeof locale.voice === "string" ? locale.voice.trim() : "";
  if (!voice) problems.push("voice: missing");
  for (const key of ["party.a", "party.b"] as const) {
    const label = strings[key];
    if (voice && typeof label === "string" && !voice.includes(`"${label}"`)) {
      problems.push(`voice: should name the party label "${label}" (${key}) in quotes`);
    }
  }
  const [a, b] = [strings["party.a"], strings["party.b"]];
  if (typeof a === "string" && typeof b === "string") {
    const listed = PARTY_LABELS[lang] ?? PARTY_LABELS.en;
    if (!/^.+A$/u.test(a) || b !== a.slice(0, -1) + "B") {
      problems.push(`party.a, party.b: should be one word with the Latin letters A and B, like "Partei A" and "Partei B"`);
    } else if (a !== listed[0] || b !== listed[1]) {
      problems.push(
        PARTY_LABELS[lang]
          ? `party.a, party.b: should match PARTY_LABELS["${lang}"] in lib/langs.ts`
          : `party.a, party.b: add "${lang}": ["${a}", "${b}"] to PARTY_LABELS in lib/langs.ts`,
      );
    }
  }
  if (locale.legalNotice !== undefined && !locale.legalNotice.trim()) problems.push("legalNotice: empty");

  for (const [group, fields] of Object.entries(EMAIL_EN)) {
    const theirs = (locale.email as Partial<Record<string, Partial<Record<string, unknown>>>> | undefined)?.[group];
    for (const field of Object.keys(fields)) {
      const value = theirs?.[field];
      if (typeof value !== "string" || !value.trim()) problems.push(`email.${group}.${field}: missing`);
    }
  }
  return problems;
}
