/** Account, entitlement and config shapes shared by the API, the website and
 * the future mobile app. Pure types: no runtime imports. */

export type GrantSource = "admin" | "app_store" | "play_store" | "web" | "promo";

export type PremiumBlock = "premium_required" | "no_credits" | "fair_use";

export type SubscriptionView = {
  source: GrantSource;
  productId: string;
  periodStart: string; // ISO
  periodEnd: string; // ISO
  willRenew: boolean;
  /** Premium verdicts funded by this subscription in the current period. */
  used: number;
  /** Fair-use cap for the period. */
  cap: number;
};

export type Entitlement = {
  /** True when a premium verdict can start right now. */
  canUsePremium: boolean;
  /** Why not, when canUsePremium is false. */
  blockedReason: PremiumBlock | null;
  /** Credit balance (credit packs). */
  credits: number;
  /** The active subscription, if any (latest periodEnd wins). */
  subscription: SubscriptionView | null;
  /** When blockedReason is "fair_use": the subscription's periodEnd. */
  resetsAt: string | null;
};

export type Viewer = {
  id: string;
  email: string;
  name: string;
  image: string | null;
};

/** The account's age check (POST /api/v1/me/age). `blocked` never goes back
 * to false. */
export type AgeState = { confirmed: boolean; blocked: boolean };

/** GET /api/v1/me. Signed out: { user: null, entitlement: null, age: null }.
 * A bearer token with no live session: 401 signin_required instead. */
export type MeResponse = {
  user: Viewer | null;
  entitlement: Entitlement | null;
  /** Absent on older servers. */
  age?: AgeState | null;
};

/** Which sign-in methods are usable on this deployment right now. */
export type AuthProviders = {
  apple: boolean;
  google: boolean;
  /** Email magic link (website). */
  email: boolean;
  /** Email one-time code (apps): POST /api/auth/email-otp/send-verification-otp
   * then POST /api/auth/sign-in/email-otp. On whenever `email` is. */
  emailCode: boolean;
  /** Dev-only test login (never true in production). */
  dev: boolean;
};

export type PricingPack = { id: string; credits: number; priceUsd: number };
export type PricingPlan = { id: string; priceUsd: number; fairUseCap: number; periodDays: number };

export type PricingInfo = {
  currency: "USD";
  /** PURCHASES_ENABLED=1 on the server; false = buy buttons say "Coming soon". */
  purchasesEnabled: boolean;
  packs: PricingPack[];
  monthly: PricingPlan;
};

/** GET /api/v1/config. One startup call for web and app. */
export type AppConfig = {
  signIn: AuthProviders;
  premiumEnabled: boolean;
  pricing: PricingInfo;
  /** Premium features this deployment offers. Absent on older servers: treat as all false. */
  features?: {
    cases: boolean;
    evidence: boolean;
    /** GET /api/v1/me/history is served. Absent on older servers. */
    history?: boolean;
    /** Send usage events to POST /api/v1/events. Absent on older servers: don't send. */
    analytics?: boolean;
  };
  /** Always false: every verdict is premium. Absent on older servers, which had a free tier. */
  freeTier?: boolean;
  /** Premium verdicts a new account starts with. */
  welcomeCredits?: number;
};
