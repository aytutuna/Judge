/**
 * Restore: asks RevenueCat what the account's store subscriptions are right
 * now and applies the active ones, so a plan does not wait for the next
 * webhook (a TRANSFER we could not match, or an account made after the
 * purchase). Credit packs are consumables and are never restored.
 *
 * RevenueCat's REST API names a subscription's latest transaction, not the
 * original one the webhook keys by, so a plan found here is stored under a
 * synthetic original id (`rcsync:`). It is only added when the account has no
 * active plan from that store, and the first webhook event for the real plan
 * replaces it (grantSubscription).
 */

import { getDb } from "./db";
import type { GrantSource } from "./account-types";
import { applyStoreEvent } from "./entitlements";
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

async function hasActivePlan(userId: string, source: GrantSource, nowIso: string): Promise<boolean> {
  const rs = await (await getDb()).execute({
    sql: "SELECT 1 FROM subscriptions WHERE user_id = ? AND source = ? AND status = 'active' AND period_end > ? LIMIT 1",
    args: [userId, source, nowIso],
  });
  return rs.rows.length > 0;
}

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
    const sandbox = raw.is_sandbox === true;
    if (sandbox && !allowSandbox) continue;
    if (await hasActivePlan(userId, source, now.toISOString())) continue;
    const originalTransactionId = `rcsync:${source}:${productId}:${first}`;
    const { applied } = await applyStoreEvent({
      type: "subscription_active",
      eventId: `${originalTransactionId}:${start}`,
      source,
      userId,
      productId,
      originalTransactionId,
      periodStart: new Date(start).toISOString(),
      periodEnd: new Date(end).toISOString(),
      willRenew: !raw.unsubscribe_detected_at,
      ...(sandbox ? { sandbox: true as const } : {}),
    });
    if (applied) added += 1;
  }
  return added;
}
