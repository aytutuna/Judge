/**
 * RevenueCat webhook events mapped to the normalized StoreEvent that
 * applyStoreEvent() in lib/entitlements.ts applies exactly once.
 *
 * Event format: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
 * (body `{ api_version, event: { id, type, app_user_id, product_id, store,
 * environment, transaction_id, original_transaction_id, purchased_at_ms,
 * expiration_at_ms, cancel_reason, ... } }`). Fields are read defensively:
 * RevenueCat documents some keys as optional and others as possibly null.
 *
 * No database access here, so the mapping is testable on its own; the route
 * resolves the user and applies the event.
 */

import { timingSafeEqual, createHash } from "node:crypto";
import type { GrantSource } from "./account-types";
import type { StoreEvent } from "./entitlements";
import { STORE_PRODUCTS } from "./pricing";

type Env = Record<string, string | undefined>;

/** REVENUECAT_WEBHOOK_SECRET, or null when unset (the webhook answers 503). */
export function revenueCatWebhookSecret(env: Env = process.env): string | null {
  return env.REVENUECAT_WEBHOOK_SECRET?.trim() || null;
}

/** Sandbox (TestFlight, Play test tracks, Stripe test mode) purchases are
 * applied only with ALLOW_SANDBOX_PURCHASES=1. */
export function sandboxPurchasesAllowed(env: Env = process.env): boolean {
  return env.ALLOW_SANDBOX_PURCHASES?.trim() === "1";
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();

/**
 * RevenueCat sends the Authorization header value set in its dashboard
 * verbatim. Accepted: `Bearer <secret>` (the documented setup) or the bare
 * secret. Compared in constant time (hashes, so lengths never leak).
 */
export function revenueCatAuthorized(header: string | null, secret: string): boolean {
  if (!header) return false;
  const value = header.trim();
  const presented = /^bearer\s+/i.test(value) ? value.replace(/^bearer\s+/i, "") : value;
  return timingSafeEqual(sha256(presented), sha256(secret));
}

const STORES: Record<string, GrantSource> = {
  APP_STORE: "app_store",
  MAC_APP_STORE: "app_store",
  PLAY_STORE: "play_store",
  STRIPE: "web",
  RC_BILLING: "web",
  PADDLE: "web",
};

/** Why an event changes nothing. Every one answers 200, so RevenueCat does
 * not retry it. */
export type IgnoreReason =
  | "sandbox"
  | "unsupported_store"
  | "unknown_product"
  | "wrong_product_kind"
  | "missing_fields"
  | "cancellation_not_refund"
  | "billing_issue"
  | "subscription_paused"
  | "transfer_not_supported"
  | "unhandled_type"
  | "unknown_user";

type GrantEvent = Extract<StoreEvent, { userId: string }>;

export type RevenueCatOutcome =
  | { kind: "invalid" }
  | { kind: "test" }
  | { kind: "ignored"; reason: IgnoreReason }
  /** Grants to an account: the route picks the first of `userIds` that exists. */
  | { kind: "grant"; userIds: string[]; event: (userId: string) => GrantEvent }
  /** Keyed by the store transaction alone (no account needed). */
  | { kind: "apply"; event: StoreEvent };

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" && v.length <= 200 ? v : null;
}

function epochMs(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 8.64e15 ? v : null;
}

const isoAt = (ms: number) => new Date(ms).toISOString();

/** Google Play subscriptions arrive as `<subscription id>:<base plan id>`. */
function productFor(id: string | null): { id: string; product: (typeof STORE_PRODUCTS)[string] } | null {
  if (!id) return null;
  const key = id.split(":")[0];
  if (!Object.hasOwn(STORE_PRODUCTS, key)) return null;
  return { id: key, product: STORE_PRODUCTS[key] };
}

const ANONYMOUS = "$RCAnonymousID:";

/** Our user id candidates: app_user_id (the apps call Purchases.logIn with
 * it), then original_app_user_id and the aliases, as RevenueCat advises.
 * Anonymous RevenueCat ids are never accounts. */
function userIdCandidates(e: Raw): string[] {
  const aliases = Array.isArray(e.aliases) ? e.aliases.slice(0, 20) : [];
  const out: string[] = [];
  for (const v of [e.app_user_id, e.original_app_user_id, ...aliases]) {
    const id = str(v);
    if (id && !id.startsWith(ANONYMOUS) && !out.includes(id)) out.push(id);
  }
  return out;
}

const ignored = (reason: IgnoreReason): RevenueCatOutcome => ({ kind: "ignored", reason });

/** The webhook body mapped to what the server should do with it. */
export function mapRevenueCatEvent(body: unknown, opts: { allowSandbox: boolean }): RevenueCatOutcome {
  if (!isObject(body) || !isObject(body.event)) return { kind: "invalid" };
  const e = body.event;
  const type = str(e.type);
  const eventId = str(e.id);
  if (!type || !eventId) return { kind: "invalid" };

  if (type === "TEST") return { kind: "test" };
  if (e.environment === "SANDBOX" && !opts.allowSandbox) return ignored("sandbox");

  switch (type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION":
    case "PRODUCT_CHANGE":
    case "NON_RENEWING_PURCHASE":
    case "CANCELLATION":
    case "EXPIRATION":
      break;
    case "BILLING_ISSUE":
      // Access continues through any grace period; EXPIRATION ends it.
      return ignored("billing_issue");
    case "SUBSCRIPTION_PAUSED":
      // Takes effect at period end; EXPIRATION (reason SUBSCRIPTION_PAUSED) ends access.
      return ignored("subscription_paused");
    case "TRANSFER":
      return ignored("transfer_not_supported");
    default:
      return ignored("unhandled_type");
  }

  const source = typeof e.store === "string" && Object.hasOwn(STORES, e.store) ? STORES[e.store] : null;
  if (!source) return ignored("unsupported_store");

  // A plan change names the new product in new_product_id when the store gives one.
  const found = productFor(type === "PRODUCT_CHANGE" ? (str(e.new_product_id) ?? str(e.product_id)) : str(e.product_id));
  if (!found) return ignored("unknown_product");
  const { id: productId, product } = found;

  const transactionId = str(e.transaction_id);
  const originalTransactionId = str(e.original_transaction_id);

  if (product.kind === "credits") {
    if (type === "NON_RENEWING_PURCHASE" || type === "INITIAL_PURCHASE") {
      if (!transactionId) return ignored("missing_fields");
      const quantity = Number.isInteger(e.quantity) && (e.quantity as number) >= 1 && (e.quantity as number) <= 100
        ? (e.quantity as number)
        : 1;
      const userIds = userIdCandidates(e);
      if (userIds.length === 0) return ignored("unknown_user");
      return {
        kind: "grant",
        userIds,
        event: (userId) => ({
          type: "credits_purchased",
          eventId,
          source,
          userId,
          productId,
          credits: product.credits * quantity,
          transactionId,
        }),
      };
    }
    if (type === "CANCELLATION") {
      if (e.cancel_reason !== "CUSTOMER_SUPPORT") return ignored("cancellation_not_refund");
      if (!transactionId) return ignored("missing_fields");
      return { kind: "apply", event: { type: "refund", eventId, source, transactionId } };
    }
    return ignored("wrong_product_kind");
  }

  // Subscription product.
  if (type === "NON_RENEWING_PURCHASE") return ignored("wrong_product_kind");
  if (!originalTransactionId) return ignored("missing_fields");

  if (type === "CANCELLATION") {
    if (e.cancel_reason === "CUSTOMER_SUPPORT") {
      return { kind: "apply", event: { type: "refund", eventId, source, transactionId: originalTransactionId } };
    }
    return { kind: "apply", event: { type: "subscription_will_not_renew", eventId, source, originalTransactionId } };
  }

  if (type === "EXPIRATION") {
    const at = epochMs(e.expiration_at_ms) ?? epochMs(e.event_timestamp_ms);
    if (at === null) return ignored("missing_fields");
    return { kind: "apply", event: { type: "subscription_expired", eventId, source, originalTransactionId, at: isoAt(at) } };
  }

  // INITIAL_PURCHASE, RENEWAL, UNCANCELLATION, PRODUCT_CHANGE: the period
  // the event reports is active and set to renew.
  const start = epochMs(e.purchased_at_ms);
  const end = epochMs(e.expiration_at_ms);
  if (start === null || end === null || end <= start) return ignored("missing_fields");
  const userIds = userIdCandidates(e);
  if (userIds.length === 0) return ignored("unknown_user");
  return {
    kind: "grant",
    userIds,
    event: (userId) => ({
      type: "subscription_active",
      eventId,
      source,
      userId,
      productId,
      originalTransactionId,
      periodStart: isoAt(start),
      periodEnd: isoAt(end),
      willRenew: true,
    }),
  };
}
