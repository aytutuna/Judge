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

export const PRICING: PricingInfo & { packs: readonly PricingPack[] } = {
  currency: "USD",
  purchasesEnabled: false,
  packs: [
    { id: "pack_10", credits: 10, priceUsd: 1.99 },
    { id: "pack_30", credits: 30, priceUsd: 4.99 },
  ],
  // One premium verdict = one credit; the monthly plan is fair-use capped.
  monthly: { id: "monthly", priceUsd: 4.99, fairUseCap: 60, periodDays: 30 },
};

/**
 * Product ids a purchase can arrive with, mapped to what they grant. The web
 * ids match PRICING; the store SKUs are placeholders to register in App Store
 * Connect and Google Play Console (letters, digits and underscores are valid
 * in both).
 */
export const STORE_PRODUCTS: Record<
  string,
  { kind: "credits"; credits: number } | { kind: "subscription"; planId: "monthly" }
> = {
  pack_10: { kind: "credits", credits: 10 },
  pack_30: { kind: "credits", credits: 30 },
  monthly: { kind: "subscription", planId: "monthly" },
  verdict_credits_10: { kind: "credits", credits: 10 },
  verdict_credits_30: { kind: "credits", credits: 30 },
  verdict_premium_monthly: { kind: "subscription", planId: "monthly" },
};

export function packById(id: string): PricingPack | undefined {
  return PRICING.packs.find((p) => p.id === id);
}

/** "$1.99" in English, "$1,99" in Turkish. */
export function formatPrice(usd: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === "tr" ? "tr-TR" : "en-US", {
    style: "currency",
    currency: PRICING.currency,
  }).format(usd);
}
