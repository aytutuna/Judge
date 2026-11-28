/**
 * The age at which a young person's own consent counts under GDPR Article 8,
 * by country. Only countries above 13 need a parent step in Judge (13 is the
 * minimum age of the service). The values are from memory of the national
 * laws and the CNIL and ICO pages, not from an official list: have them
 * checked by a lawyer before launch. A correction is one line here.
 *
 * Sources: GDPR Art. 8(1) (16, member states may lower it to 13); CNIL, "digital
 * rights of children" (France, 15); ICO, children's consent (UK, 13).
 */

/** EU and EEA countries. One missing from the table below counts as 16. */
export const EU_EEA = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IS", "IT", "LV", "LI",
  "LT", "LU", "MT", "NL", "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
] as const;

const AGES: Record<string, number> = {
  DE: 16, NL: 16, IE: 16, PL: 16, HU: 16, HR: 16, RO: 16, SK: 16, LU: 16, LI: 16,
  FR: 15, CZ: 15, GR: 15, SI: 15,
  AT: 14, IT: 14, ES: 14, BG: 14, CY: 14, LT: 14,
  BE: 13, DK: 13, EE: 13, FI: 13, LV: 13, MT: 13, PT: 13, SE: 13, NO: 13, IS: 13,
};

/** The consent age for a two-letter country code; 13 outside the EU and EEA. */
export function consentAge(country: string): number {
  return AGES[country] ?? ((EU_EEA as readonly string[]).includes(country) ? 16 : 13);
}
