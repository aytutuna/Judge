import { describe, expect, it } from "vitest";
import {
  acceptLanguageTags,
  ENABLED,
  isEnabled,
  isLang,
  LANG_CODES,
  LANGS,
  langDir,
  langOfTag,
  langTag,
  matchLang,
} from "../lib/langs";
import { CreateCaseRequest } from "../lib/case-types";
import { VerdictRequest, VerdictResult } from "../lib/types";
import { formatDate } from "../lib/i18n";
import { formatPrice } from "../lib/pricing";
import { TR_RESULT } from "./translate-fixtures";

describe("language registry", () => {
  it("lists the App Store languages once each, English and Turkish first", () => {
    expect(LANG_CODES).toHaveLength(45);
    expect(new Set(LANG_CODES).size).toBe(LANG_CODES.length);
    expect(LANG_CODES.slice(0, 2)).toEqual(["en", "tr"]);
    for (const code of ["zh-Hans", "zh-Hant", "pt-BR", "pt-PT", "nb", "or", "ur"]) expect(isLang(code)).toBe(true);
    expect(isLang("pt")).toBe(false);
    expect(isLang("toString")).toBe(false);
  });

  it("gives every language a native name, an English name and a tag Intl accepts", () => {
    for (const code of LANG_CODES) {
      const l = LANGS[code];
      expect(l.native.trim(), code).not.toBe("");
      expect(l.name.trim(), code).not.toBe("");
      expect(Intl.getCanonicalLocales(l.tag), code).toHaveLength(1);
    }
  });

  it("writes Arabic, Hebrew and Urdu right to left and nothing else", () => {
    expect(LANG_CODES.filter((l) => langDir(l) === "rtl")).toEqual(["ar", "he", "ur"]);
    expect(langDir("en")).toBe("ltr");
  });

  it("enables English and Turkish only", () => {
    expect(ENABLED).toEqual(["en", "tr"]);
    expect(isEnabled("tr")).toBe(true);
    expect(isEnabled("de")).toBe(false);
    expect(isEnabled("xx")).toBe(false);
  });

  it("keeps the old en-US / tr-TR formatting", () => {
    expect(langTag("en")).toBe("en-US");
    expect(langTag("tr")).toBe("tr-TR");
    expect(formatPrice(7.5, "en")).toBe("$7.50");
    expect(formatPrice(7.5, "tr")).toBe("$7,50");
    expect(formatDate("tr", "2026-11-18T12:00:00Z")).toBe("18 Kasım");
  });

  it("formats dates and prices for a language without strings", () => {
    expect(formatDate("de", "2026-11-18T12:00:00Z")).toBe("18. November");
    expect(formatPrice(7.5, "de")).toMatch(/7,50/);
  });
});

describe("matching browser languages", () => {
  const all = LANG_CODES;

  it("maps regional and legacy tags onto registry codes", () => {
    expect(langOfTag("en-GB")).toBe("en");
    expect(langOfTag("es-MX")).toBe("es");
    expect(langOfTag("fr_CA")).toBe("fr");
    expect(langOfTag("TR-tr")).toBe("tr");
    expect(langOfTag("zh")).toBe("zh-Hans");
    expect(langOfTag("zh-CN")).toBe("zh-Hans");
    expect(langOfTag("zh-TW")).toBe("zh-Hant");
    expect(langOfTag("zh-HK")).toBe("zh-Hant");
    expect(langOfTag("zh-Hant")).toBe("zh-Hant");
    expect(langOfTag("zh-Hans-HK")).toBe("zh-Hans");
    expect(langOfTag("pt")).toBe("pt-BR");
    expect(langOfTag("pt-BR")).toBe("pt-BR");
    expect(langOfTag("pt-PT")).toBe("pt-PT");
    expect(langOfTag("pt-AO")).toBe("pt-PT");
    expect(langOfTag("no")).toBe("nb");
    expect(langOfTag("nn-NO")).toBe("nb");
    expect(langOfTag("nb")).toBe("nb");
    expect(langOfTag("xx-YY")).toBeNull();
  });

  it("takes the first preference that is enabled, else English", () => {
    expect(matchLang(["tr-TR", "en"])).toBe("tr");
    expect(matchLang(["en-US", "tr"])).toBe("en");
    expect(matchLang(["de-DE", "tr"])).toBe("tr");
    expect(matchLang(["de-DE", "fr"])).toBe("en");
    expect(matchLang([])).toBe("en");
    expect(matchLang(["zh-TW", "en"], all)).toBe("zh-Hant");
    expect(matchLang(["pt-PT"], all)).toBe("pt-PT");
    expect(matchLang(["nn"], all)).toBe("nb");
  });

  it("reads Accept-Language in the order sent", () => {
    expect(acceptLanguageTags("tr-TR,tr;q=0.9,en-US;q=0.8,*;q=0.5")).toEqual(["tr-TR", "tr", "en-US"]);
    expect(acceptLanguageTags("")).toEqual([]);
    expect(matchLang(acceptLanguageTags("de-DE,de;q=0.9,tr;q=0.8"))).toBe("tr");
  });
});

describe("schemas", () => {
  const result = TR_RESULT;

  it("accept every registry language and keep old rows parsing", () => {
    for (const lang of [undefined, "en", "tr", "de", "zh-Hant"]) {
      const parsed = VerdictResult.safeParse({ ...result, lang });
      expect(parsed.success, String(lang)).toBe(true);
    }
    expect(VerdictResult.safeParse({ ...result, lang: "xx" }).success).toBe(false);
  });

  it("default requests to English", () => {
    const argument = "We argued about whose turn it was to do the dishes.";
    expect(VerdictRequest.parse({ argument }).lang).toBe("en");
    expect(VerdictRequest.parse({ argument, lang: "ja" }).lang).toBe("ja");
    expect(CreateCaseRequest.safeParse({ text: argument, lang: "ar" }).success).toBe(true);
  });
});
