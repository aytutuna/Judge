/**
 * Premium prices and store products: the one place to change them.
 * Pure module (no Next, DOM or Node imports) so the mobile app can reuse it.
 *
 * Prices are placeholders until a payment provider is wired up; while
 * `purchasesEnabled` is false the buy buttons read "Coming soon".
 */

import type { PricingInfo, PricingPack } from "./account-types";
import type { Lang } from "./i18n";

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

/** "$7.50" in English, "$7,50" in Turkish. */
export function formatPrice(usd: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === "tr" ? "tr-TR" : "en-US", {
    style: "currency",
    currency: PRICING.currency,
  }).format(usd);
}
