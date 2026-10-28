import { describe, expect, it } from "vitest";
import { EMAIL_EN } from "../lib/email";
import { EN, type Locale } from "../lib/i18n";
import { ENABLED, importLocale } from "../lib/langs";
import { checkLocale, requiredPluralForms } from "../lib/locales/check";

describe("locale check", () => {
  it("passes every enabled locale", async () => {
    for (const lang of ENABLED) {
      const mod = importLocale(lang);
      if (!mod) continue;
      expect(checkLocale(lang, (await mod).default), lang).toEqual([]);
    }
  });

  it("knows which plural forms a language needs for counts above one", () => {
    expect(requiredPluralForms("de")).toEqual([]);
    expect(requiredPluralForms("ja")).toEqual([]);
    expect(requiredPluralForms("ru").sort()).toEqual(["few", "many", "one"]);
    expect(requiredPluralForms("ar").sort()).toEqual(["few", "many", "two"]);
  });

  it("asks for the form of 1 where the caller can pass 1", () => {
    expect(requiredPluralForms("de", "wait.minutes")).toEqual([]);
    expect(requiredPluralForms("de", "panel.quick")).toEqual(["one"]);
    expect(requiredPluralForms("ja", "panel.quick")).toEqual([]);
    expect(requiredPluralForms("pl", "home.monthLeft").sort()).toEqual(["few", "many", "one"]);
    const locale = {
      voice: 'Refer to the parties as "Parte A" and "Parte B".',
      strings: { ...EN, "party.a": "Parte A", "party.b": "Parte B" },
      email: EMAIL_EN,
    } as unknown as Locale;
    expect(checkLocale("es", locale)).toEqual([
      "plurals.panel.strong.one: missing",
      "plurals.panel.quick.one: missing",
      "plurals.home.monthLeft.one: missing",
      "plurals.thread.judgesAgree.one: missing",
    ]);
  });

  it("reports what a translator got wrong", () => {
    const strings: Partial<typeof EN> = { ...EN };
    delete strings["nav.skip"];
    const broken = {
      voice: 'Use "du". Call them Partei A and Partei B.',
      strings: {
        ...strings,
        "party.a": "Partei A",
        "party.b": "Partei B",
        "wait.minutes": "{count} минут",
        "hero.title": " ",
        "privacy.title": undefined,
        "extra.key": "x",
      },
      plurals: { "wait.minutes": { one: "{n} минута", two: "{n} x" }, "nav.home": { one: "x" } },
      email: { ...EMAIL_EN, caseReady: { ...EMAIL_EN.caseReady, note: "" } },
    } as unknown as Locale;
    const problems = checkLocale("ru", broken);
    for (const expected of [
      "nav.skip: missing",
      "hero.title: empty",
      "extra.key: not an English key",
      "wait.minutes: slots {count} but English has {n}",
      "plurals.wait.minutes.two: ru has no such form (its forms: one, few, many)",
      "plurals.wait.minutes.few: missing",
      "plurals.nav.home: not a count string (see COUNT_KEYS)",
      'voice: should name the party label "Partei A" (party.a) in quotes',
      "email.caseReady.note: missing",
    ]) {
      expect(problems).toContain(expected);
    }
    expect(problems.some((p) => p.startsWith("privacy page is partly translated"))).toBe(true);
  });

  it("accepts a locale that leaves the privacy page to English", () => {
    const strings = Object.fromEntries(Object.entries(EN).filter(([k]) => !k.startsWith("privacy.")));
    const locale = {
      voice: 'Refer to the parties as "当事者A" and "当事者B".',
      strings: { ...strings, "party.a": "当事者A", "party.b": "当事者B" },
      email: EMAIL_EN,
    } as unknown as Locale;
    expect(checkLocale("ja", locale)).toEqual([]);
  });
});
