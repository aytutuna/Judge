import { useSyncExternalStore } from "react";
import type { AppConfig, Entitlement, MeResponse } from "./account-types";

/**
 * Client store for "who is signed in, what can they use, and what does this
 * deployment offer": GET /api/v1/me plus GET /api/v1/config, loaded once per
 * page on first use and shared by the nav, the hero switch and the account,
 * sign-in and pricing pages.
 *
 * Module-level external store read through useSyncExternalStore (the shape
 * of lib/lang.ts). The server snapshot is the empty "idle" state, so server
 * HTML and the first client render never show account UI: nothing renders
 * until the real answer is in, and a free visitor's page stays as it was.
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

let state: ViewerState = IDLE;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: ViewerState): void {
  state = next;
  for (const fn of listeners) fn();
}

/** Fetch /me and /config. Concurrent callers share one request. */
export function refreshViewer(): Promise<void> {
  if (inflight) return inflight;
  if (state.status === "idle") emit({ ...state, status: "loading" });
  inflight = (async () => {
    try {
      const { fetchConfig, fetchMe } = await import("./auth-client");
      const [config, me] = await Promise.allSettled([fetchConfig(), fetchMe()]);
      emit({
        status: me.status === "fulfilled" ? "ready" : "error",
        me: me.status === "fulfilled" ? me.value : null,
        config: config.status === "fulfilled" ? config.value : null,
      });
    } catch {
      emit({ status: "error", me: null, config: null });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Swap in the balance a premium verdict response carried, without a refetch. */
export function applyEntitlement(entitlement: Entitlement): void {
  if (!state.me?.user) return;
  emit({ ...state, me: { ...state.me, entitlement } });
}

/** After sign-out or account deletion: signed out, config unchanged. */
export function markSignedOut(): void {
  emit({ ...state, status: "ready", me: { user: null, entitlement: null } });
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // First subscriber starts the load (client only: the server never
  // subscribes). Deferred so the store never emits during subscribe.
  if (state.status === "idle" && !inflight) void Promise.resolve().then(refreshViewer);
  return () => {
    listeners.delete(onChange);
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
