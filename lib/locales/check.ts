import { EMAIL_EN } from "../email";
import { COUNT_KEYS, EN, type CountKey, type Key, type Locale } from "../i18n";
import { langTag, type Lang } from "../langs";

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
 * language uses for 2 to 1000 (callers already handle 1 with its own key). */
export function requiredPluralForms(lang: Lang): Intl.LDMLPluralRule[] {
  const rules = new Intl.PluralRules(langTag(lang));
  const seen = new Set<Intl.LDMLPluralRule>();
  for (let n = 2; n <= 1000; n++) seen.add(rules.select(n));
  seen.delete("other");
  return [...seen];
}

/**
 * Everything wrong with a locale file, one line each; empty when it is fine.
 * Same keys as English (the privacy page's all or none), the same {slots}
 * in every string and plural form, nothing empty, plural forms only in
 * categories the language has and every one it needs, a voice note that
 * names the party labels, and complete email copy.
 */
export function checkLocale(lang: Lang, locale: Locale): string[] {
  const problems: string[] = [];
  const strings = locale.strings as Partial<Record<string, unknown>>;
  const keys = Object.keys(EN) as Key[];

  const legal = keys.filter((k) => k.startsWith("privacy."));
  const legalCount = legal.filter((k) => strings[k] !== undefined).length;
  if (legalCount > 0 && legalCount < legal.length) {
    problems.push(`privacy page is partly translated (${legalCount} of ${legal.length} privacy.* strings): give all or none`);
  }

  for (const key of keys) {
    const value = strings[key];
    if (value === undefined) {
      if (!key.startsWith("privacy.") || legalCount > 0) problems.push(`${key}: missing`);
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
  const required = requiredPluralForms(lang);
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
      } else if (placeholders(form) !== placeholders(EN[key as CountKey])) {
        problems.push(`plurals.${key}.${category}: slots ${placeholders(form) || "(none)"} but English has ${placeholders(EN[key as CountKey])}`);
      }
    }
  }
  for (const key of COUNT_KEYS) {
    for (const category of required) {
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
