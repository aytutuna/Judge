import { describe, expect, it } from "vitest";
import { EMAIL_EN } from "../lib/email";
import { COUNT_KEYS, EN, formatWait, loadedDict, pluralCategory, registerLocale, t, type Locale } from "../lib/i18n";

const ru: Locale = {
  voice: "",
  strings: { ...EN, "wait.minutes": "{n} минут", "home.left.other": "Осталось вердиктов: {n}" },
  plurals: {
    "wait.minutes": { one: "{n} минута", few: "{n} минуты", many: "{n} минут" },
  },
  email: EMAIL_EN,
};
registerLocale("ru", ru);

describe("plural forms", () => {
  it("knows each language's categories", () => {
    expect(pluralCategory("ru", 21)).toBe("one");
    expect(pluralCategory("ru", 3)).toBe("few");
    expect(pluralCategory("ru", 11)).toBe("many");
    expect(pluralCategory("pl", 22)).toBe("few");
    expect(pluralCategory("ar", 2)).toBe("two");
    expect(pluralCategory("ja", 1)).toBe("other");
  });

  it("picks the form for n and falls back to the base string", () => {
    expect(t("ru", "wait.minutes", { n: 2 })).toBe("2 минуты");
    expect(t("ru", "wait.minutes", { n: 5 })).toBe("5 минут");
    expect(t("ru", "wait.minutes", { n: 21 })).toBe("21 минута");
    expect(t("ru", "wait.minutes", { n: 1.5 })).toBe("1.5 минут");
    expect(t("ru", "home.left.other", { n: 3 })).toBe("Осталось вердиктов: 3");
    expect(formatWait("ru", 60 * 22)).toBe("22 минуты");
  });

  it("only counts a numeric n", () => {
    expect(t("ru", "wait.minutes", { n: "2" })).toBe("2 минут");
  });

  it("leaves English and Turkish as they were", () => {
    expect(t("en", "wait.minutes", { n: 21 })).toBe("21 minutes");
    expect(t("tr", "wait.minutes", { n: 21 })).not.toMatch(/\{n\}/);
    expect(t("tr", "panel.quick", { n: 1 })).toBe(t("tr", "panel.quick", { n: 2 }).replace("2", "1"));
  });

  it("hands the forms to the browser with the strings", () => {
    expect(loadedDict("ru")?.plurals).toEqual(ru.plurals);
  });

  it("lists only keys that count with {n}", () => {
    for (const key of COUNT_KEYS) expect(EN[key], key).toContain("{n}");
  });
});
