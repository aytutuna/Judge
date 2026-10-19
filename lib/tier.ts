import { useSyncExternalStore } from "react";
import type { AppConfig, Entitlement, MeResponse } from "./account-types";
import type { Tier } from "./types";

/**
 * The Free / Premium choice on the homepage: what the viewer may pick
 * (`tierAvailability`, pure) and what they last picked (a module-level store
 * persisted to localStorage, the same shape as lib/lang.ts).
 *
 * The remembered choice is only a preference: `effectiveTier` turns it into
 * a premium request only while the account can actually use premium, so a
 * stale "premium" never sends a premium request for a signed-out visitor.
 */

/** - hidden: premium is off on this deployment (or config not loaded yet),
 *   or the viewer is signed out and no sign-in method is set up: no switch
 *   at all, the hero is exactly today's.
 * - signed_out: switch shown, Premium locked behind sign-in.
 * - locked: signed in, but no credits or allowance right now.
 * - available: both options selectable. */
export type TierAvailability = "hidden" | "signed_out" | "locked" | "available";

/** True when this deployment offers at least one way to sign in. Without
 * one, nothing should point a signed-out visitor to /signin. */
export function signInOffered(config: AppConfig | null): boolean {
  const s = config?.signIn;
  return Boolean(s && (s.apple || s.google || s.email || s.dev));
}

export function tierAvailability(config: AppConfig | null, me: MeResponse | null): TierAvailability {
  if (!config?.premiumEnabled) return "hidden";
  if (!me?.user) return signInOffered(config) ? "signed_out" : "hidden";
  return me.entitlement?.canUsePremium ? "available" : "locked";
}

export function effectiveTier(availability: TierAvailability, choice: Tier): Tier {
  return availability === "available" && choice === "premium" ? "premium" : "free";
}

/** What is left to spend right now: the subscription's monthly allowance
 * first (it funds a verdict before credits do), then credit packs. */
export type PremiumRemaining = { kind: "monthly" | "credits"; n: number };

export function premiumRemaining(e: Entitlement | null | undefined): PremiumRemaining | null {
  if (!e) return null;
  const sub = e.subscription;
  if (sub && sub.cap - sub.used > 0) return { kind: "monthly", n: sub.cap - sub.used };
  if (e.credits > 0) return { kind: "credits", n: e.credits };
  return null;
}

/* ---------- remembered choice ---------- */

const STORAGE_KEY = "verdict-tier";

let current: Tier | null = null;
const listeners = new Set<() => void>();

function readStorage(): Tier | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "free" || v === "premium" ? v : null;
  } catch {
    return null;
  }
}

export function setTierChoice(tier: Tier): void {
  current = tier;
  try {
    localStorage.setItem(STORAGE_KEY, tier);
  } catch {
    // Storage unavailable: `current` still drives the UI.
  }
  for (const fn of listeners) fn();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): Tier {
  return current ?? readStorage() ?? "free";
}

function getServerSnapshot(): Tier {
  return "free";
}

export function useTierChoice(): Tier {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
