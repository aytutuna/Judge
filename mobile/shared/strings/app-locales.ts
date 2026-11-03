import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { langTag, type Lang } from "../../../lib/langs";
import { APP_COUNT_KEYS, APP_EN, type AppKey, type AppLocale } from "./app-strings";

export const LOCALES_DIR = join(__dirname, "locales");

/** The app strings of `lang`, or null when it has no file yet. */
export async function loadAppLocale(lang: Lang): Promise<AppLocale | null> {
  const path = join(LOCALES_DIR, `${lang}.ts`);
  if (!existsSync(path)) return null;
  const mod = (await import(pathToFileURL(path).href)) as { default: AppLocale | { default: AppLocale } };
  // tsx hands a CommonJS default back one level deeper.
  return "default" in mod.default ? mod.default.default : mod.default;
}

/** Strings where "Judge" is the verb, not the app's name. */
const JUDGE_VERB: readonly AppKey[] = ["app.case.judgeNowWithout"];

const placeholders = (s: string) => [...new Set(s.match(/\{[A-Za-z]+\}/g) ?? [])].sort().join(" ");

/** The plural categories an app count string needs besides "other": every
 * one the language uses from 1 to 1000, since the apps hand it 1 as well. */
export function requiredAppForms(lang: Lang): Intl.LDMLPluralRule[] {
  const rules = new Intl.PluralRules(langTag(lang));
  const seen = new Set<Intl.LDMLPluralRule>();
  for (let n = 1; n <= 1000; n++) seen.add(rules.select(n));
  seen.delete("other");
  return [...seen];
}

/** A category that stands for one number only (English "one", Arabic
 * "two"), whose form may spell the number out instead of using {n}. */
function isExact(lang: Lang, category: string): boolean {
  const rules = new Intl.PluralRules(langTag(lang));
  let hits = 0;
  for (let n = 0; n <= 1000; n++) if (rules.select(n) === category) hits++;
  return hits === 1;
}

/**
 * Everything wrong with an app locale file, one line each; empty when it is
 * fine. Same keys as English, the same {slots}, nothing empty, the brand
 * left as "Judge", and plural forms only in categories the language has,
 * with every one it needs.
 */
export function checkAppLocale(lang: Lang, locale: AppLocale): string[] {
  const problems: string[] = [];
  const strings = (locale.strings ?? {}) as Partial<Record<string, unknown>>;
  for (const key of Object.keys(APP_EN) as AppKey[]) {
    const value = strings[key];
    if (value === undefined) {
      problems.push(`${key}: missing`);
    } else if (typeof value !== "string" || !value.trim()) {
      problems.push(`${key}: empty`);
    } else {
      if (placeholders(value) !== placeholders(APP_EN[key])) {
        problems.push(`${key}: slots ${placeholders(value) || "(none)"} but English has ${placeholders(APP_EN[key]) || "(none)"}`);
      }
      if (APP_EN[key].includes("Judge") && !JUDGE_VERB.includes(key) && !value.includes("Judge")) {
        problems.push(`${key}: keep the name "Judge" as written`);
      }
    }
  }
  for (const key of Object.keys(strings)) {
    if (!(key in APP_EN)) problems.push(`${key}: not an English key`);
  }

  const categories = new Intl.PluralRules(langTag(lang)).resolvedOptions().pluralCategories as string[];
  const plurals = (locale.plurals ?? {}) as Partial<Record<string, Partial<Record<string, unknown>>>>;
  for (const [key, forms] of Object.entries(plurals)) {
    if (!(APP_COUNT_KEYS as readonly string[]).includes(key)) {
      problems.push(`plurals.${key}: not a count string (see APP_COUNT_KEYS)`);
      continue;
    }
    const english = APP_EN[key as AppKey];
    for (const [category, form] of Object.entries(forms ?? {})) {
      if (category === "other" || !categories.includes(category)) {
        problems.push(
          `plurals.${key}.${category}: ${lang} has no such form (its forms: ${categories.filter((c) => c !== "other").join(", ") || "none"})`,
        );
      } else if (typeof form !== "string" || !form.trim()) {
        problems.push(`plurals.${key}.${category}: empty`);
      } else if (
        placeholders(form) !== placeholders(english) &&
        !(isExact(lang, category) && placeholders(form) === placeholders(english.split("{n}").join("")))
      ) {
        problems.push(`plurals.${key}.${category}: slots ${placeholders(form) || "(none)"} but English has ${placeholders(english)}`);
      }
    }
  }
  for (const key of APP_COUNT_KEYS) {
    for (const category of requiredAppForms(lang)) {
      if (plurals[key]?.[category] === undefined) problems.push(`plurals.${key}.${category}: missing`);
    }
  }
  return problems;
}
