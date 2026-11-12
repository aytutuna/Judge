import { useSyncExternalStore } from "react";
import type { AgeState, AppConfig, Entitlement, MeResponse } from "./account-types";

/**
 * Client store for "who is signed in, what can they use, and what does this
 * deployment offer": GET /api/v1/me plus GET /api/v1/config, loaded once per
 * page on first use and shared by the nav, the home page and the account,
 * sign-in and pricing pages.
 *
 * Module-level external store read through useSyncExternalStore (the shape
 * of lib/lang.ts). The server snapshot is the empty "idle" state, so server
 * HTML and the first client render never show account UI: nothing renders
 * until the real answer is in.
 *
 * lib/auth-client is imported lazily: the Better Auth client stays out of
 * the homepage's first bundle and only loads once the store starts.
 */

export type ViewerStatus = "idle" | "loading" | "ready" | "error";

export type ViewerState = {
  status: ViewerStatus;
  /** Null until loaded, and when the /me call failed. */
  me: MeResponse | null;
  /** Null until loaded, and when the /config call failed (no premium UI). */
  config: AppConfig | null;
};

const IDLE: ViewerState = { status: "idle", me: null, config: null };
const SIGNED_OUT: MeResponse = { user: null, entitlement: null, age: null };

/** True when this deployment offers at least one way to sign in. Without
 * one, nothing should point a signed-out visitor to /signin. */
export function signInOffered(config: AppConfig | null): boolean {
  const s = config?.signIn;
  return Boolean(s && (s.apple || s.google || s.email || s.dev));
}

let state: ViewerState = IDLE;
let inflight: Promise<void> | null = null;
// Set when a refresh failed and the old answer was kept; the next focus
// tries once more.
let retryOnFocus = false;
let retrying = false;
const listeners = new Set<() => void>();

function emit(next: ViewerState): void {
  state = next;
  for (const fn of listeners) fn();
}

/** Fetch /me and /config. Concurrent callers share one request. A failed
 * call keeps what the store already had; only a 401 from /me signs out. */
export function refreshViewer(): Promise<void> {
  if (inflight) return inflight;
  if (state.status === "idle") emit({ ...state, status: "loading" });
  inflight = (async () => {
    try {
      const { fetchConfig, fetchMe } = await import("./auth-client");
      const [config, me] = await Promise.allSettled([fetchConfig(), fetchMe()]);
      const unauthorized = me.status === "rejected" && (me.reason as { status?: number })?.status === 401;
      const failed = me.status === "rejected" && !unauthorized;
      retryOnFocus = (failed || config.status === "rejected") && !retrying;
      emit({
        status: failed && !state.me ? "error" : "ready",
        me: me.status === "fulfilled" ? me.value : unauthorized ? SIGNED_OUT : state.me,
        config: config.status === "fulfilled" ? config.value : state.config,
      });
    } catch {
      retryOnFocus = !retrying;
      emit({ ...state, status: state.me ? "ready" : "error" });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Whether the store holds a signed-in user right now. */
export function viewerSignedIn(): boolean {
  return Boolean(state.me?.user);
}

/** Swap in the age check POST /api/v1/me/age answered with. */
export function applyAge(age: AgeState): void {
  if (!state.me?.user) return;
  emit({ ...state, me: { ...state.me, age } });
}

/** Swap in the balance a premium verdict response carried, without a refetch. */
export function applyEntitlement(entitlement: Entitlement): void {
  if (!state.me?.user) return;
  emit({ ...state, me: { ...state.me, entitlement } });
}

/** After sign-out or account deletion: signed out, config unchanged. */
export function markSignedOut(): void {
  emit({ ...state, status: "ready", me: SIGNED_OUT });
}

function retryNow(): void {
  if (!retryOnFocus || document.visibilityState === "hidden") return;
  retryOnFocus = false;
  retrying = true;
  void refreshViewer().finally(() => {
    retrying = false;
  });
}

function subscribe(onChange: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("focus", retryNow);
    document.addEventListener("visibilitychange", retryNow);
  }
  listeners.add(onChange);
  // First subscriber starts the load (client only: the server never
  // subscribes). Deferred so the store never emits during subscribe.
  if (state.status === "idle" && !inflight) void Promise.resolve().then(refreshViewer);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      window.removeEventListener("focus", retryNow);
      document.removeEventListener("visibilitychange", retryNow);
    }
  };
}

function getSnapshot(): ViewerState {
  return state;
}

function getServerSnapshot(): ViewerState {
  return IDLE;
}

export function useViewer(): ViewerState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
