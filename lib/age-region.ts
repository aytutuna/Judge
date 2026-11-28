/**
 * Where a teen lives decides two things (see lib/age.ts): whether a parent
 * has to say yes (Quebec at 13, an EU or EEA country below its GDPR Article 8
 * age) and whether Judge refuses the account (Brazil under 18). The signals
 * are the IP country, the store's country and what the person says; the
 * strictest wins, so a value from the client or the person can only add a
 * rule, never remove one. Pure: no database, no request.
 */

import { youngerThan } from "./age-date";
import { consentAge } from "./age-consent-ages";

/** Where each signal puts the person. Any may be missing. */
export type Geo = {
  ipCountry?: string | null;
  /** The IP's region code, only read when the country is CA. */
  ipRegion?: string | null;
  storeCountry?: string | null;
  declaredCountry?: string | null;
  /** The person's answer to "Do you live in Quebec?". */
  quebec?: boolean | null;
};

const CODE = /^[A-Z]{2}$/;

export const isCountryCode = (v: unknown): v is string => typeof v === "string" && CODE.test(v);

/** What the date step stores: every country a signal named, sorted, and
 * whether Quebec applies. */
export function geoToStored(geo: Geo): { countries: string[]; quebec: boolean } {
  const countries = [...new Set([geo.ipCountry, geo.storeCountry, geo.declaredCountry].filter(isCountryCode))].sort();
  const quebec = geo.quebec === true || (geo.ipCountry === "CA" && geo.ipRegion === "QC");
  return { countries, quebec };
}

export const parseCountries = (stored: unknown): string[] =>
  typeof stored === "string" ? stored.split(",").filter(isCountryCode) : [];

/** The age below which a parent has to say yes. 13 means no step. */
export function parentAge(countries: string[], quebec: boolean): number {
  return Math.max(13, quebec ? 14 : 13, ...countries.map(consentAge));
}

/** True for a date of birth that needs a parent in these places. Under 13 is
 * blocked elsewhere and never gets here. */
export function needsParent(dob: string | null, countries: string[], quebec: boolean, now = new Date()): boolean {
  return dob !== null && youngerThan(dob, parentAge(countries, quebec), now);
}

/** Brazil's 18+ rule: the person is under 18 by their date of birth and a
 * signal says Brazil. */
export function brazilRefusal(dob: string | null, countries: string[], now = new Date()): boolean {
  return dob !== null && countries.includes("BR") && youngerThan(dob, 18, now);
}

/** A store country changes the stored places only when it adds a rule: Brazil,
 * or an age above what is already required. */
export function tightens(country: string, countries: string[], quebec: boolean): boolean {
  if (countries.includes(country)) return false;
  return country === "BR" || consentAge(country) > parentAge(countries, quebec);
}
