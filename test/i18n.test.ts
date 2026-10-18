import { describe, expect, it } from "vitest";
import { KEY_BY_CAPTION } from "../components/ThinkingDig";
import {
  ERROR_KEY_BY_CODE,
  STRINGS,
  apiErrorMessage,
  contentLang,
  formatWait,
  t,
  type Key,
} from "../lib/i18n";
import { partyNames } from "../lib/names";
import { FINISH_CAPTION, READY, STILL_JUDGING, THINKING_STEPS } from "../lib/thinking";
import { VerdictRequest } from "../lib/types";

const EN_KEYS = Object.keys(STRINGS.en).sort();
const TR_KEYS = Object.keys(STRINGS.tr).sort();

/** Intentionally language-invariant: each toggle aria label is written in
 * the language of the audience it serves. */
const IDENTICAL_ALLOWLIST = new Set<Key>(["langToggle.toTr", "langToggle.toEn"]);

describe("STRINGS table", () => {
  it("en and tr have identical key sets, both directions", () => {
    expect(TR_KEYS).toEqual(EN_KEYS);
  });

  it("every value is non-empty and tr contains no TODO", () => {
    for (const key of EN_KEYS as Key[]) {
      expect(STRINGS.en[key].length, `en.${key}`).toBeGreaterThan(0);
      expect(STRINGS.tr[key].length, `tr.${key}`).toBeGreaterThan(0);
      expect(STRINGS.tr[key], `tr.${key}`).not.toContain("TODO");
    }
  });

  it("tr equals en only for the explicit allowlist", () => {
    for (const key of EN_KEYS as Key[]) {
      if (IDENTICAL_ALLOWLIST.has(key)) {
        expect(STRINGS.tr[key], key).toBe(STRINGS.en[key]);
      } else {
        expect(STRINGS.tr[key], key).not.toBe(STRINGS.en[key]);
      }
    }
  });
});

describe("t()", () => {
  it("returns the right string per lang", () => {
    expect(t("en", "verdict.split")).toBe("Split decision");
    expect(t("tr", "verdict.split")).toBe("Bölünmüş karar");
  });

  it("substitutes {name} and {n} template slots", () => {
    expect(t("en", "verdict.win", { name: "Ayşe" })).toBe("Ayşe is right");
    expect(t("tr", "verdict.win", { name: "Ayşe" })).toBe("Ayşe haklı");
    expect(t("en", "lean.title", { name: "Ayşe" })).toBe(
      "Forced ruling: Ayşe is more right",
    );
    expect(t("tr", "lean.title", { name: "Ayşe" })).toBe(
      "Zorunlu hüküm: Ayşe daha haklı",
    );
    expect(t("tr", "judgesVoted.other", { n: 3 })).toBe(
      "3 bağımsız yapay zekâ yargıcı oy verdi:",
    );
  });

  it("substitutes multiple vars in one string", () => {
    expect(t("en", "confidenceWord", { word: "High", n: 4 })).toBe("High confidence · 4/5");
    expect(t("tr", "confidenceWord", { word: "Yüksek", n: 4 })).toBe("Yüksek güven · 4/5");
    expect(t("tr", "slider.aria", { left: "Akıl", right: "Kalp" })).toBe(
      "Akıl / Kalp dengesi",
    );
  });

  it("leaves unknown braces alone", () => {
    expect(t("en", "verdict.win", { other: "x" })).toBe("{name} is right");
    expect(t("en", "verdict.win")).toBe("{name} is right");
  });
});

describe("partyNames", () => {
  it("defaults per lang", () => {
    expect(partyNames(undefined)).toEqual({
      nameA: "Party A",
      nameB: "Party B",
      aIsSelf: false,
      bIsSelf: false,
    });
    expect(partyNames([], "tr")).toEqual({
      nameA: "Taraf A",
      nameB: "Taraf B",
      aIsSelf: false,
      bIsSelf: false,
    });
  });

  it('a friend named "Ben" in slot B stays "Ben" in both langs (slot guard)', () => {
    const map = [{ original: "Ben", replacement: "Party B" }];
    for (const lang of ["en", "tr"] as const) {
      const p = partyNames(map, lang);
      expect(p.nameB).toBe("Ben");
      expect(p.bIsSelf).toBe(false);
    }
  });

  it('"Ben" in slot A is second person only under tr (language gate)', () => {
    const map = [{ original: "Ben", replacement: "Party A" }];
    const tr = partyNames(map, "tr");
    expect(tr.nameA).toBe("Sen");
    expect(tr.aIsSelf).toBe(true);
    const en = partyNames(map, "en");
    expect(en.nameA).toBe("Ben");
    expect(en.aIsSelf).toBe(false);
  });

  it('all-caps "BENİM" matches under tr case folding', () => {
    const p = partyNames([{ original: "BENİM", replacement: "Party A" }], "tr");
    expect(p.nameA).toBe("Sen");
    expect(p.aIsSelf).toBe(true);
  });

  it('"I" in slot A becomes "You" under en', () => {
    const p = partyNames([{ original: "I", replacement: "Party A" }], "en");
    expect(p.nameA).toBe("You");
    expect(p.aIsSelf).toBe(true);
  });
});

describe("VerdictRequest.lang", () => {
  const argument = "This is a long enough argument between two people, honest.";

  it('defaults to "en"', () => {
    const parsed = VerdictRequest.safeParse({ argument });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.lang).toBe("en");
  });

  it('accepts "tr" and rejects "de"', () => {
    const tr = VerdictRequest.safeParse({ argument, lang: "tr" });
    expect(tr.success).toBe(true);
    if (tr.success) expect(tr.data.lang).toBe("tr");
    expect(VerdictRequest.safeParse({ argument, lang: "de" }).success).toBe(false);
  });
});

describe("ThinkingDig caption map", () => {
  it("covers every caption thinking.ts can emit", () => {
    const captions = [
      ...THINKING_STEPS.map((s) => s.caption),
      FINISH_CAPTION,
      STILL_JUDGING,
      READY,
    ];
    for (const c of captions) {
      const key = KEY_BY_CAPTION[c];
      expect(key, `caption "${c}"`).toBeDefined();
      expect(STRINGS.en[key], `key ${key}`).toBeDefined();
    }
  });
});

describe("ERROR_KEY_BY_CODE", () => {
  it("maps every code the route can emit to a real key", () => {
    const codes = [
      "invalid",
      "too_short",
      "too_long",
      "not_configured",
      "quota",
      "unavailable",
      "rate_limited",
      "daily_cap",
      "captcha_failed",
    ];
    for (const code of codes) {
      const key = ERROR_KEY_BY_CODE[code];
      expect(key, code).toBeDefined();
      expect(STRINGS.en[key as Key]).toBeDefined();
      expect(STRINGS.tr[key as Key]).toBeDefined();
    }
  });
});

describe("formatWait", () => {
  it("rounds seconds up to whole minutes below 90 minutes", () => {
    expect(formatWait("en", 1)).toBe("1 minute");
    expect(formatWait("en", 60)).toBe("1 minute");
    expect(formatWait("en", 61)).toBe("2 minutes");
    expect(formatWait("tr", 300)).toBe("5 dakika");
    expect(formatWait("en", 89 * 60)).toBe("89 minutes");
  });

  it("switches to whole hours from 90 minutes up", () => {
    expect(formatWait("en", 90 * 60)).toBe("2 hours");
    expect(formatWait("en", 3600 * 7 + 1)).toBe("8 hours");
    expect(formatWait("tr", 3600 * 5)).toBe("5 saat");
  });

  it("falls back to a vague phrase for missing or nonsense input", () => {
    for (const v of [undefined, null, "60", Number.NaN, Infinity, 0, -5]) {
      expect(formatWait("en", v)).toBe("a few minutes");
    }
    expect(formatWait("tr", undefined)).toBe("birkaç dakika");
  });
});

describe("apiErrorMessage", () => {
  it("localizes a known code", () => {
    expect(apiErrorMessage("tr", { error: "Too short", code: "too_short" })).toBe(
      STRINGS.tr["error.too_short"],
    );
  });

  it("fills the wait slot for rate_limited and daily_cap", () => {
    expect(apiErrorMessage("en", { code: "rate_limited", retryAfterSec: 240 }, 429)).toBe(
      "Order in the court! You've hit the limit for now. Try again in 4 minutes.",
    );
    const tr = apiErrorMessage("tr", { code: "daily_cap", retryAfterSec: 3600 * 6 }, 503);
    expect(tr).toContain("6 saat sonra");
    expect(tr).not.toContain("{wait}");
  });

  it("never leaves a raw {wait} slot, even without retryAfterSec", () => {
    const msg = apiErrorMessage("en", { code: "daily_cap" }, 503);
    expect(msg).toContain("a few minutes");
    expect(msg).not.toContain("{");
  });

  it("treats a bare 429 (non-JSON body) as a rate limit", () => {
    expect(apiErrorMessage("en", null, 429)).toContain("Try again in a few minutes");
  });

  it("falls back to server text, then to the generic message", () => {
    expect(apiErrorMessage("en", { error: "Boom", code: "mystery" })).toBe("Boom");
    expect(apiErrorMessage("tr", { code: "mystery" }, 500)).toBe(STRINGS.tr.errorFallback);
    expect(apiErrorMessage("en", null, 500)).toBe(STRINGS.en.errorFallback);
  });

  it("localizes captcha_failed", () => {
    expect(apiErrorMessage("tr", { code: "captcha_failed" }, 403)).toBe(
      STRINGS.tr["error.captcha_failed"],
    );
  });
});

describe("contentLang", () => {
  it("detects Turkish verdict text", () => {
    expect(contentLang("Taraf A haklı çünkü domates botanik olarak meyve.")).toBe("tr");
    expect(contentLang("Sosisli kendi başına bir kategori.")).toBe("tr");
  });

  it("defaults to English", () => {
    expect(contentLang("Party A is right: a tomato is botanically a fruit.")).toBe("en");
    expect(contentLang("")).toBe("en");
  });
});

describe("example disputes", () => {
  const exampleKeys = (Object.keys(STRINGS.en) as Key[]).filter(
    (k) => k.startsWith("example.") && k.endsWith(".text"),
  );

  it("there are four to six of them, each with a label", () => {
    expect(exampleKeys.length).toBeGreaterThanOrEqual(4);
    expect(exampleKeys.length).toBeLessThanOrEqual(6);
    for (const k of exampleKeys) {
      expect(STRINGS.en[k.replace(/\.text$/, ".label") as Key], k).toBeDefined();
    }
  });

  it("every example passes the API's 20..6000 character limits in both languages", () => {
    for (const k of exampleKeys) {
      for (const lang of ["en", "tr"] as const) {
        const len = STRINGS[lang][k].trim().length;
        expect(len, `${lang}.${k}`).toBeGreaterThanOrEqual(20);
        expect(len, `${lang}.${k}`).toBeLessThanOrEqual(6000);
      }
    }
  });
});
