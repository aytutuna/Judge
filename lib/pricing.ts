/**
 * Premium prices and store products: the one place to change them.
 * Pure module (no Next, DOM or Node imports) so the mobile app can reuse it.
 *
 * `purchasesEnabled` here is the default (false: the buy buttons read
 * "Coming soon"); the server reports PURCHASES_ENABLED=1 as true in
 * GET /api/v1/config.
 */

import type { PricingInfo, PricingPack } from "./account-types";
import type { Lang } from "./i18n";
import { langDir, langTag } from "./langs";

export const PRICING: PricingInfo & { packs: readonly PricingPack[] } = {
  currency: "USD",
  purchasesEnabled: false,
  packs: [
    { id: "pack_1", credits: 1, priceUsd: 1 },
    { id: "pack_10", credits: 10, priceUsd: 7.5 },
  ],
  // One premium verdict = one credit; the monthly plan has a visible monthly cap.
  monthly: { id: "monthly", priceUsd: 15, fairUseCap: 35, periodDays: 30 },
};

/**
 * Product ids a purchase can arrive with, mapped to what they grant. The web
 * ids match PRICING, and the store SKUs use these same ids (register them in
 * App Store Connect and Google Play Console).
 */
export const STORE_PRODUCTS: Record<
  string,
  { kind: "credits"; credits: number } | { kind: "subscription"; planId: "monthly" }
> = {
  pack_1: { kind: "credits", credits: 1 },
  pack_10: { kind: "credits", credits: 10 },
  monthly: { kind: "subscription", planId: "monthly" },
};

export function packById(id: string): PricingPack | undefined {
  return PRICING.packs.find((p) => p.id === id);
}

/** US dollars in the language's number format: "$7.50" in English, "$7,50"
 * in Turkish. */
export function formatPrice(usd: number, lang: Lang): string {
  const s = new Intl.NumberFormat(langTag(lang), {
    style: "currency",
    currency: PRICING.currency,
  }).format(usd);
  // Arabic's "7.50 US$" ends on a neutral "$" that a right-to-left line
  // moves in front of "US"; a closing LRM keeps it in place.
  return langDir(lang) === "rtl" ? s + "‎" : s;
}
