import { useCallback, useEffect, useRef, useState } from "react";
import type { CaseView } from "./case-types";

/**
 * Loads one case view (owner: GET /api/v1/cases/{id}; respondent:
 * GET /api/v1/respond/{token}) and keeps it fresh while something is being
 * judged: the server says how long to wait (`pollAfterMs`), and the hook
 * asks again after that, backing off on network trouble and pausing while
 * the tab is hidden. Actions that answer with a new view (submit, judge,
 * appeal) hand it over with `setView`, which also restarts polling.
 * `extraHeaders` go with every GET (the respondent's claim secret); a change
 * loads the view again.
 */

/** A new Idempotency-Key. randomUUID needs a secure context; plain-http
 * hosts fall back to getRandomValues. */
export function idempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** One key per exact request body: a retry of the same request reuses it
 * (the server replays instead of charging again); a different body gets a
 * new one. */
export function keyHolder(): (body: string) => string {
  let held: { body: string; key: string } | null = null;
  return (body) => {
    if (held?.body === body) return held.key;
    held = { body, key: idempotencyKey() };
    return held.key;
  };
}

export type CaseLoadStatus = "loading" | "ready" | "missing" | "signin" | "error";

export type CaseLoad = {
  status: CaseLoadStatus;
  /** The last good view; kept through a failed refresh. */
  view: CaseView | null;
  /** The API error code of the last failed load, if any. */
  code: string | null;
};

/** Longest wait between polls after repeated failures. */
export const MAX_POLL_BACKOFF_MS = 30_000;

/** Milliseconds until the next poll, or null for none. `failures` counts
 * consecutive failed refreshes since the last good one. */
export function nextPollDelay(view: CaseView | null, failures: number): number | null {
  if (!view || view.pollAfterMs === null || view.pollAfterMs === undefined) return null;
  const base = Math.max(1000, view.pollAfterMs);
  if (failures <= 0) return base;
  return Math.min(MAX_POLL_BACKOFF_MS, base * 2 ** Math.min(failures, 5));
}

/** How a failed response reads, keeping the last view when there is one. */
export function failedLoad(prev: CaseLoad, httpStatus: number | null, code: string | null): CaseLoad {
  if (httpStatus === 404 || code === "not_found") return { status: "missing", view: null, code };
  if (httpStatus === 401 || code === "signin_required") return { status: "signin", view: null, code };
  if (prev.view) return { ...prev, code };
  return { status: "error", view: null, code };
}

export function useCase(
  url: string,
  extraHeaders: Record<string, string> | null = null,
): {
  load: CaseLoad;
  setView: (view: CaseView) => void;
  reload: () => void;
} {
  const [load, setLoad] = useState<CaseLoad>({ status: "loading", view: null, code: null });
  const [tick, setTick] = useState(0);
  const failures = useRef(0);
  const headerKey = extraHeaders ? JSON.stringify(extraHeaders) : "";

  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      let res: Response;
      try {
        const extra = headerKey ? (JSON.parse(headerKey) as Record<string, string>) : {};
        res = await fetch(url, { cache: "no-store", signal: ctrl.signal, headers: { Accept: "application/json", ...extra } });
      } catch {
        if (ctrl.signal.aborted) return;
        failures.current += 1;
        setLoad((prev) => failedLoad(prev, null, null));
        return;
      }
      const json = (await res.json().catch(() => null)) as { case?: CaseView; code?: unknown } | null;
      if (ctrl.signal.aborted) return;
      if (res.ok && json?.case) {
        failures.current = 0;
        setLoad({ status: "ready", view: json.case, code: null });
        return;
      }
      failures.current += 1;
      const code = typeof json?.code === "string" ? json.code : null;
      setLoad((prev) => failedLoad(prev, res.status, code));
    })();
    return () => ctrl.abort();
  }, [url, tick, headerKey]);

  useEffect(() => {
    const delay = nextPollDelay(load.view, failures.current);
    if (delay === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      timer = setTimeout(() => {
        if (document.hidden) document.addEventListener("visibilitychange", onVisible);
        else setTick((n) => n + 1);
      }, delay);
    };
    const onVisible = () => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", onVisible);
      setTick((n) => n + 1);
    };
    arm();
    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const setView = useCallback((view: CaseView) => {
    failures.current = 0;
    setLoad({ status: "ready", view, code: null });
  }, []);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  return { load, setView, reload };
}
