import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LocaleStrings } from "../components/LocaleStrings";
import { SkipLink } from "../components/SiteChrome";
import { EN, loadedDict, registerLocale, t } from "../lib/i18n";
import de from "../lib/locales/de";
import tr from "../lib/locales/tr";

describe("loading languages on demand", () => {
  it("reads English until a language's strings arrive", async () => {
    vi.resetModules();
    const fresh = await import("../lib/i18n");
    expect(fresh.hasStrings("tr")).toBe(false);
    expect(fresh.t("tr", "nav.skip")).toBe(EN["nav.skip"]);
    const first = fresh.loadLocale("tr");
    expect(fresh.loadLocale("tr")).toBe(first);
    await first;
    expect(fresh.hasStrings("tr")).toBe(true);
    expect(fresh.t("tr", "nav.skip")).toBe(tr.strings["nav.skip"]);
  });

  it("tells subscribers when strings arrive", async () => {
    vi.resetModules();
    const fresh = await import("../lib/i18n");
    const seen = vi.fn();
    const off = fresh.subscribeLocales(seen);
    await fresh.loadLocale("tr");
    off();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("leaves languages that are not enabled in English", async () => {
    vi.resetModules();
    vi.doMock("../lib/langs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../lib/langs")>()),
      importLocale: () => null,
    }));
    const fresh = await import("../lib/i18n");
    vi.doUnmock("../lib/langs");
    await expect(fresh.loadLocale("de")).resolves.toBeUndefined();
    expect(fresh.hasStrings("de")).toBe(false);
    expect(fresh.t("de", "nav.skip")).toBe(EN["nav.skip"]);
  });

  it("hands the browser only what it needs, never for English", () => {
    expect(loadedDict("en")).toBeNull();
    expect(loadedDict("tr")).toEqual({ strings: tr.strings, plurals: tr.plurals });
    expect(loadedDict("de")).toEqual({ strings: de.strings, plurals: de.plurals, legalNotice: de.legalNotice });
  });

  it("registers server-rendered strings before the page renders with them", () => {
    const strings = { ...EN, "nav.skip": "Zum Inhalt springen" };
    const html = renderToStaticMarkup(
      <LocaleStrings lang="de" dict={{ strings }}>
        <SkipLink lang="de" />
      </LocaleStrings>,
    );
    expect(html).toContain("Zum Inhalt springen");
    // The first registration stays.
    registerLocale("de", { strings: EN });
    expect(t("de", "nav.skip")).toBe("Zum Inhalt springen");
  });
});
