/**
 * Restore: asks RevenueCat what the account's store subscriptions are right
 * now and applies the active ones, so a plan does not wait for the next
 * webhook (a TRANSFER we could not match, or an account made after the
 * purchase). Credit packs are consumables and are never restored.
 *
 * Neither REST API gives the store's original transaction id the webhook
 * keys plans by (v1 has store_transaction_id with no stated meaning; v2's
 * store_subscription_identifier is the latest App Store transaction or the
 * last Google order id: https://www.revenuecat.com/docs/api-v2/subscription-data-model),
 * so a plan found here is stored under a stand-in id `rcsync:<user>:...`.
 * grantRestoredSubscription adds it only where the account holds no plan of
 * that store; the first webhook for the real plan, a TRANSFER, a refund or
 * an expiry retires it.
 */

import type { GrantSource } from "./account-types";
import { grantRestoredSubscription } from "./entitlements";
import { STORE_PRODUCTS } from "./pricing";
import { sandboxPurchasesAllowed } from "./revenuecat";

type Env = Record<string, string | undefined>;

/** REVENUECAT_API_KEY (a secret key of the RevenueCat project), or null when unset. */
export function revenueCatApiKey(env: Env = process.env): string | null {
  return env.REVENUECAT_API_KEY?.trim() || null;
}

const STORES: Record<string, GrantSource> = {
  app_store: "app_store",
  mac_app_store: "app_store",
  play_store: "play_store",
  stripe: "web",
  rc_billing: "web",
  paddle: "web",
};

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const time = (v: unknown): number | null => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Applies the account's active RevenueCat subscriptions that we do not hold
 * yet. Returns how many it added. Throws when RevenueCat cannot be reached. */
export async function syncRevenueCat(
  userId: string,
  apiKey: string,
  opts: { now?: Date; allowSandbox?: boolean } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const allowSandbox = opts.allowSandbox ?? sandboxPurchasesAllowed();
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`RevenueCat answered ${res.status}`);
  const body: unknown = await res.json();
  const subs = isObject(body) && isObject(body.subscriber) && isObject(body.subscriber.subscriptions) ? body.subscriber.subscriptions : {};

  let added = 0;
  for (const [key, raw] of Object.entries(subs)) {
    const productId = key.split(":")[0];
    if (!Object.hasOwn(STORE_PRODUCTS, productId) || STORE_PRODUCTS[productId].kind !== "subscription") continue;
    if (!isObject(raw)) continue;
    const source = typeof raw.store === "string" && Object.hasOwn(STORES, raw.store) ? STORES[raw.store] : null;
    const end = time(raw.expires_date);
    const start = time(raw.purchase_date);
    const first = time(raw.original_purchase_date) ?? start;
    if (!source || end === null || start === null || first === null || end <= now.getTime() || end <= start) continue;
    if (raw.refunded_at) continue;
    // No grace period: a plan whose renewal failed ends at its last paid period.
    if (raw.billing_issues_detected_at || raw.grace_period_expires_date) continue;
    const sandbox = raw.is_sandbox === true;
    if (sandbox && !allowSandbox) continue;
    // Per period: a stand-in retired earlier does not block a new subscription.
    const originalTransactionId = `rcsync:${userId}:${source}:${productId}:${first}:${start}`;
    const { applied } = await grantRestoredSubscription({
      userId,
      source,
      productId,
      originalTransactionId,
      externalId: originalTransactionId,
      periodStart: new Date(start).toISOString(),
      periodEnd: new Date(end).toISOString(),
      willRenew: !raw.unsubscribe_detected_at,
      sandbox: sandbox || undefined,
    });
    if (applied) added += 1;
  }
  return added;
}
