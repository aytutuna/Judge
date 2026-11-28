import { describe, expect, it } from "vitest";
import { consentAge, EU_EEA } from "../lib/age-consent-ages";
import { brazilRefusal, geoToStored, needsParent, parentAge, parseCountries, tightens } from "../lib/age-region";
import { regionOf } from "../lib/analytics/validate";

const NOW = new Date("2026-11-28T12:00:00Z");
/** A date of birth that makes the person exactly `years` and a bit old on NOW. */
const dobAged = (years: number) => `${2026 - years}-06-01`;

describe("article 8 ages", () => {
  it("has the countries above 13 at their age", () => {
    expect(consentAge("DE")).toBe(16);
    expect(consentAge("FR")).toBe(15);
    expect(consentAge("ES")).toBe(14);
    expect(consentAge("BE")).toBe(13);
  });

  it("counts a country outside the EU and EEA as 13, and one inside that is missing from the table as 16", () => {
    expect(consentAge("US")).toBe(13);
    expect(consentAge("GB")).toBe(13);
    expect(consentAge("BR")).toBe(13);
    expect(EU_EEA).toHaveLength(30);
    expect(EU_EEA.every((c) => consentAge(c) >= 13)).toBe(true);
  });
});

describe("what the date step stores", () => {
  it("joins every country a signal named, sorted and without repeats", () => {
    expect(geoToStored({ ipCountry: "FR", storeCountry: "DE", declaredCountry: "FR" }).countries).toEqual(["DE", "FR"]);
    expect(geoToStored({ ipCountry: null, storeCountry: "xx", declaredCountry: undefined }).countries).toEqual([]);
  });

  it("takes Quebec from the answer, or from the IP region of a Canadian IP", () => {
    expect(geoToStored({ quebec: true }).quebec).toBe(true);
    expect(geoToStored({ ipCountry: "CA", ipRegion: "QC" }).quebec).toBe(true);
    expect(geoToStored({ ipCountry: "CA", ipRegion: "ON" }).quebec).toBe(false);
    expect(geoToStored({ ipCountry: "US", ipRegion: "QC" }).quebec).toBe(false);
  });

  it("lets the answer 'no' leave a QC header standing: strictest wins", () => {
    expect(geoToStored({ ipCountry: "CA", ipRegion: "QC", quebec: false }).quebec).toBe(true);
  });

  it("parses a stored list and ignores junk", () => {
    expect(parseCountries("DE,FR")).toEqual(["DE", "FR"]);
    expect(parseCountries("DE,,x1")).toEqual(["DE"]);
    expect(parseCountries(null)).toEqual([]);
  });
});

describe("who needs a parent", () => {
  it("is nobody in a country at 13", () => {
    expect(needsParent(dobAged(14), ["US"], false, NOW)).toBe(false);
    expect(needsParent(dobAged(14), [], false, NOW)).toBe(false);
    expect(needsParent(dobAged(14), ["BE", "SE"], false, NOW)).toBe(false);
  });

  it("is a 13 year old in Quebec, and only that age", () => {
    expect(needsParent(dobAged(13), ["CA"], true, NOW)).toBe(true);
    expect(needsParent(dobAged(14), ["CA"], true, NOW)).toBe(false);
    expect(needsParent(dobAged(13), ["CA"], false, NOW)).toBe(false);
  });

  it("is a teen under the country's age in the EU and EEA, up to that age", () => {
    expect(needsParent(dobAged(15), ["DE"], false, NOW)).toBe(true);
    expect(needsParent(dobAged(16), ["DE"], false, NOW)).toBe(false);
    expect(needsParent(dobAged(14), ["FR"], false, NOW)).toBe(true);
    expect(needsParent(dobAged(15), ["FR"], false, NOW)).toBe(false);
    expect(needsParent(dobAged(13), ["IT"], false, NOW)).toBe(true);
    expect(needsParent(dobAged(14), ["IT"], false, NOW)).toBe(false);
  });

  it("ends on the birthday itself", () => {
    expect(needsParent("2010-11-29", ["DE"], false, NOW)).toBe(true);
    expect(needsParent("2010-11-28", ["DE"], false, NOW)).toBe(false);
  });

  it("takes the strictest of several countries", () => {
    expect(parentAge(["US", "ES", "DE"], false)).toBe(16);
    expect(needsParent(dobAged(15), ["US", "DE"], false, NOW)).toBe(true);
    expect(parentAge(["US"], true)).toBe(14);
    expect(parentAge(["DE"], true)).toBe(16);
  });

  it("is nobody without a stored date (an adult)", () => {
    expect(needsParent(null, ["DE"], true, NOW)).toBe(false);
  });
});

describe("Brazil", () => {
  it("refuses under 18 when any signal says Brazil", () => {
    expect(brazilRefusal(dobAged(15), ["BR"], NOW)).toBe(true);
    expect(brazilRefusal(dobAged(17), ["BR", "US"], NOW)).toBe(true);
    expect(brazilRefusal(dobAged(15), ["US"], NOW)).toBe(false);
  });

  it("lets go on the 18th birthday", () => {
    expect(brazilRefusal("2008-11-29", ["BR"], NOW)).toBe(true);
    expect(brazilRefusal("2008-11-28", ["BR"], NOW)).toBe(false);
    expect(brazilRefusal(null, ["BR"], NOW)).toBe(false);
  });
});

describe("a later store country", () => {
  it("only tightens", () => {
    expect(tightens("BR", [], false)).toBe(true);
    expect(tightens("DE", ["FR"], false)).toBe(true);
    expect(tightens("FR", ["DE"], false)).toBe(false);
    expect(tightens("US", ["DE"], false)).toBe(false);
    expect(tightens("DE", ["DE"], false)).toBe(false);
    expect(tightens("ES", [], true)).toBe(false);
    expect(tightens("FR", [], true)).toBe(true);
  });
});

describe("the IP region", () => {
  const headers = (country: string, region: string) => new Headers({ "cf-ipcountry": country, "cf-region-code": region });
  const on = { CLOUDFLARE_PROXY: "1" };

  it("is read only behind the proxy and only for Canada", () => {
    expect(regionOf(headers("CA", "qc"), on)).toBe("QC");
    expect(regionOf(headers("CA", "QC"), {})).toBeNull();
    expect(regionOf(headers("US", "CA"), on)).toBeNull();
    expect(regionOf(new Headers({ "cf-ipcountry": "CA" }), on)).toBeNull();
  });
});
