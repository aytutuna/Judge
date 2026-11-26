import type { SubscriptionView } from "./account-types";

export type StoreBilling = { store: "apple" | "google"; manageUrl: string };

const APPLE_MANAGE = "https://apps.apple.com/account/subscriptions";
const GOOGLE_MANAGE = "https://play.google.com/store/account/subscriptions";

/** The store still billing this plan after the account is deleted, or null
 * when no store does (no plan, a plan that ends by itself, a plan outside
 * the stores). */
export function storeBilling(sub: SubscriptionView | null | undefined): StoreBilling | null {
  if (!sub?.willRenew) return null;
  if (sub.source === "app_store") return { store: "apple", manageUrl: APPLE_MANAGE };
  if (sub.source === "play_store") return { store: "google", manageUrl: GOOGLE_MANAGE };
  return null;
}
