import type { Locale } from "./i18n";

/**
 * Every interface language the apps can ship, App Store locales with the
 * regional English, Spanish and French merged. `name` is the English name
 * (used in prompts), `native` what the language picker shows, `tag` the
 * BCP-47 tag for Intl and `script` the writing system the translation check
 * expects. Pure: safe on the server and in the browser.
 */
export const LANGS = {
  en: { name: "English", native: "English", tag: "en-US", script: "Latin" },
  tr: { name: "Turkish", native: "Türkçe", tag: "tr-TR", script: "Latin" },
  ar: { name: "Arabic", native: "العربية", tag: "ar", script: "Arabic", rtl: true },
  bn: { name: "Bengali", native: "বাংলা", tag: "bn", script: "Bengali" },
  ca: { name: "Catalan", native: "Català", tag: "ca", script: "Latin" },
  "zh-Hans": { name: "Simplified Chinese", native: "简体中文", tag: "zh-Hans", script: "Han" },
  "zh-Hant": { name: "Traditional Chinese", native: "繁體中文", tag: "zh-Hant", script: "Han" },
  hr: { name: "Croatian", native: "Hrvatski", tag: "hr", script: "Latin" },
  cs: { name: "Czech", native: "Čeština", tag: "cs", script: "Latin" },
  da: { name: "Danish", native: "Dansk", tag: "da", script: "Latin" },
  nl: { name: "Dutch", native: "Nederlands", tag: "nl", script: "Latin" },
  fi: { name: "Finnish", native: "Suomi", tag: "fi", script: "Latin" },
  fr: { name: "French", native: "Français", tag: "fr", script: "Latin" },
  de: { name: "German", native: "Deutsch", tag: "de", script: "Latin" },
  el: { name: "Greek", native: "Ελληνικά", tag: "el", script: "Greek" },
  gu: { name: "Gujarati", native: "ગુજરાતી", tag: "gu", script: "Gujarati" },
  he: { name: "Hebrew", native: "עברית", tag: "he", script: "Hebrew", rtl: true },
  hi: { name: "Hindi", native: "हिन्दी", tag: "hi", script: "Devanagari" },
  hu: { name: "Hungarian", native: "Magyar", tag: "hu", script: "Latin" },
  id: { name: "Indonesian", native: "Bahasa Indonesia", tag: "id", script: "Latin" },
  it: { name: "Italian", native: "Italiano", tag: "it", script: "Latin" },
  ja: { name: "Japanese", native: "日本語", tag: "ja", script: "Japanese" },
  kn: { name: "Kannada", native: "ಕನ್ನಡ", tag: "kn", script: "Kannada" },
  ko: { name: "Korean", native: "한국어", tag: "ko", script: "Hangul" },
  ms: { name: "Malay", native: "Bahasa Melayu", tag: "ms", script: "Latin" },
  ml: { name: "Malayalam", native: "മലയാളം", tag: "ml", script: "Malayalam" },
  mr: { name: "Marathi", native: "मराठी", tag: "mr", script: "Devanagari" },
  nb: { name: "Norwegian Bokmål", native: "Norsk bokmål", tag: "nb", script: "Latin" },
  or: { name: "Odia", native: "ଓଡ଼ିଆ", tag: "or", script: "Oriya" },
  pl: { name: "Polish", native: "Polski", tag: "pl", script: "Latin" },
  "pt-BR": { name: "Brazilian Portuguese", native: "Português (Brasil)", tag: "pt-BR", script: "Latin" },
  "pt-PT": { name: "European Portuguese", native: "Português (Portugal)", tag: "pt-PT", script: "Latin" },
  pa: { name: "Punjabi", native: "ਪੰਜਾਬੀ", tag: "pa", script: "Gurmukhi" },
  ro: { name: "Romanian", native: "Română", tag: "ro", script: "Latin" },
  ru: { name: "Russian", native: "Русский", tag: "ru", script: "Cyrillic" },
  sk: { name: "Slovak", native: "Slovenčina", tag: "sk", script: "Latin" },
  sl: { name: "Slovenian", native: "Slovenščina", tag: "sl", script: "Latin" },
  es: { name: "Spanish", native: "Español", tag: "es", script: "Latin" },
  sv: { name: "Swedish", native: "Svenska", tag: "sv", script: "Latin" },
  ta: { name: "Tamil", native: "தமிழ்", tag: "ta", script: "Tamil" },
  te: { name: "Telugu", native: "తెలుగు", tag: "te", script: "Telugu" },
  th: { name: "Thai", native: "ไทย", tag: "th", script: "Thai" },
  uk: { name: "Ukrainian", native: "Українська", tag: "uk", script: "Cyrillic" },
  ur: { name: "Urdu", native: "اردو", tag: "ur", script: "Arabic", rtl: true },
  vi: { name: "Vietnamese", native: "Tiếng Việt", tag: "vi", script: "Latin" },
} as const satisfies Record<
  string,
  { name: string; native: string; tag: string; script: string; rtl?: true }
>;

export type Lang = keyof typeof LANGS;

export const LANG_CODES = Object.keys(LANGS) as [Lang, ...Lang[]];

/**
 * The languages that have strings, besides English (the source, always on).
 * Enabling a language is one line here once lib/locales/<code>.ts exists.
 * Each one is its own chunk: the browser only downloads the one in use.
 */
const LOCALES: Partial<Record<Lang, () => Promise<{ default: Locale }>>> = {
  tr: () => import("./locales/tr"),
};

/** Enabled languages, in registry order (English first). */
export const ENABLED: readonly Lang[] = LANG_CODES.filter((l) => l === "en" || l in LOCALES);

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && Object.hasOwn(LANGS, v);
}

export function isEnabled(v: unknown): v is Lang {
  return isLang(v) && ENABLED.includes(v);
}

/** The locale module of an enabled language; null for English and for
 * languages that are not enabled. */
export function importLocale(lang: Lang): Promise<{ default: Locale }> | null {
  return LOCALES[lang]?.() ?? null;
}

export function langDir(lang: Lang): "ltr" | "rtl" {
  return "rtl" in LANGS[lang] ? "rtl" : "ltr";
}

export function langTag(lang: Lang): string {
  return LANGS[lang].tag;
}

/** The registry language a BCP-47 tag means, or null. Chinese goes by script,
 * then region; Portuguese is Brazilian unless another region is given; the
 * Norwegian tags all mean Bokmål. */
export function langOfTag(tag: string): Lang | null {
  const [base, ...rest] = tag.trim().toLowerCase().split(/[-_]/);
  if (base === "zh") {
    if (rest.includes("hans")) return "zh-Hans";
    if (rest.includes("hant") || rest.some((p) => p === "tw" || p === "hk" || p === "mo")) return "zh-Hant";
    return "zh-Hans";
  }
  if (base === "pt") return rest.length === 0 || rest.includes("br") ? "pt-BR" : "pt-PT";
  if (base === "no" || base === "nn" || base === "nb") return "nb";
  return isLang(base) ? base : null;
}

/** The first preference (browser order) that names an enabled language, else English. */
export function matchLang(prefs: readonly string[], enabled: readonly Lang[] = ENABLED): Lang {
  for (const p of prefs) {
    const l = langOfTag(p);
    if (l && enabled.includes(l)) return l;
  }
  return "en";
}

/** The tags of an Accept-Language header, in the order sent. */
export function acceptLanguageTags(header: string): string[] {
  return header
    .split(",")
    .map((part) => part.split(";")[0].trim())
    .filter((tag) => tag && tag !== "*");
}
