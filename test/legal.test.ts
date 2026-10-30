import { describe, expect, it, vi } from "vitest";
import { EMAIL_EN } from "../lib/email";
import type { LegalKey, Locale } from "../lib/i18n";
import tr from "../lib/locales/tr";

// A copy with nothing loaded, so the stand-ins below take the place of the
// real German and French files.
vi.resetModules();
const { EN, legalLang, legalNotice, loadedDict, registerLocale, t } = await import("../lib/i18n");
registerLocale("tr", tr);

const legal = Object.keys(EN).filter((k) => k.startsWith("privacy.")) as LegalKey[];
const withoutLegal = Object.fromEntries(Object.entries(EN).filter(([k]) => !k.startsWith("privacy."))) as Locale["strings"];

registerLocale("de", { voice: "", strings: withoutLegal, email: EMAIL_EN });
registerLocale("fr", {
  voice: "",
  strings: { ...EN, "privacy.title": "Confidentialité" },
  legalNotice: "En cas de différence, la version anglaise fait foi.",
  email: EMAIL_EN,
});

describe("privacy page languages", () => {
  it("shows English where a locale has no privacy page", () => {
    expect(legal.length).toBeGreaterThan(10);
    expect(legalLang("de")).toBe("en");
    expect(legalNotice("de")).toBeNull();
    expect(t("de", "privacy.title")).toBe(EN["privacy.title"]);
  });

  it("shows the translation with its notice where there is one", () => {
    expect(legalLang("fr")).toBe("fr");
    expect(t("fr", "privacy.title")).toBe("Confidentialité");
    expect(legalNotice("fr")).toMatch(/version anglaise/);
    expect(loadedDict("fr")?.legalNotice).toMatch(/version anglaise/);
  });

  it("picks the terms page's language on its own", () => {
    expect(legalLang("de", "terms")).toBe("de");
    expect(legalLang("de", "privacy")).toBe("en");
    expect(legalNotice("fr", "terms")).toMatch(/version anglaise/);
  });

  it("keeps Turkish and English as they were", () => {
    expect(legalLang("tr")).toBe("tr");
    expect(legalNotice("tr")).toBeNull();
    expect(legalLang("en")).toBe("en");
    expect(legalNotice("en")).toBeNull();
  });
});
