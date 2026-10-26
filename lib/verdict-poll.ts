/**
 * Async verdicts: the request preference, the response shapes and a polling
 * helper for clients. A verdict can take longer than a proxy allows one
 * request to stay open (Cloudflare ends it after 100 s), so a client that
 * sends `Prefer: respond-async` gets `202 { id, status: "judging" }` right
 * after its text is anonymized and polls GET /api/v1/verdicts/{id} until the
 * verdict is ready or failed.
 * Pure module: no Next, DOM or Node imports, so a React Native app can reuse it.
 */

import type { Entitlement } from "./account-types";
import type { AppealBlock } from "./case-types";
import type { DisplayState } from "./originals-types";
import type { NameMapping, StoredVerdictResponse, VerdictAppealView } from "./types";

/** The `Prefer` token that asks for a 202 instead of waiting (RFC 7240). */
export const RESPOND_ASYNC = "respond-async";

/** What the server suggests between polls while a verdict is judging. */
export const POLL_AFTER_MS = 2000;

export type VerdictJobStatus = "judging" | "ready" | "failed";

/** Why a verdict failed in the background. `refused` is reserved: a model
 * refusal is still delivered as a ready verdict with `model_refused: true`. */
export type VerdictJobErrorCode = "quota" | "unavailable" | "refused";

/** POST /api/v1/verdict with `Prefer: respond-async` (or `"async": true`):
 * the verdict is being judged under `id`. Keep `name_map` and `owner_token`
 * now; the poll answer does not repeat them. */
export type VerdictAcceptedResponse = {
  id: string;
  status: "judging";
  pollAfterMs: number;
  /** Path to poll: /api/v1/verdicts/{id}. */
  poll: string;
  name_map: NameMapping[];
  /** Signed-out writers only, returned once (see VerdictResponse). */
  owner_token?: string;
  suggested_display_a?: string | null;
  /** Premium: the entitlement right after the unit was reserved. */
  entitlement?: Entitlement;
  /** Premium: an Idempotency-Key retry joined the verdict already judging
   * (name_map is [] then). */
  replayed?: boolean;
};

/** The writer's share-page state, returned on a ready poll only to the
 * writer (X-Owner-Token header or the owning session). */
export type VerdictOwnerState = {
  originals_stored: boolean;
  display: DisplayState;
  /** Whether the writer may add context now (absent on case verdicts and
   * on the verdicts appeals produced). */
  appeal?: { allowed: boolean; blockedBy: AppealBlock | null };
};

/** POST /api/v1/verdicts/{id}/appeals (202): the context is anonymized and
 * being judged. Poll `poll` like an async verdict; keep `name_map`. */
export type VerdictAppealResponse = {
  appeal: VerdictAppealView;
  appeals: VerdictAppealView[];
  poll: string;
  pollAfterMs: number;
  name_map: NameMapping[];
  entitlement?: Entitlement;
  /** An Idempotency-Key retry of an appeal already made (name_map is [] then). */
  replayed?: boolean;
};

/** GET /api/v1/verdicts/{id}, always HTTP 200 for these three states. */
export type VerdictPollResponse =
  | { id: string; status: "judging"; pollAfterMs: number }
  | { id: string; status: "failed"; code: VerdictJobErrorCode; error: string }
  | (StoredVerdictResponse & { status: "ready"; owner?: VerdictOwnerState });

export type ReadyPollResponse = Extract<VerdictPollResponse, { status: "ready" }>;

type HeaderBag = { get(name: string): string | null };

/** True when the request opts into the async flow: a `Prefer` header with
 * the respond-async token, or `"async": true` in the JSON body. */
export function wantsAsync(headers: HeaderBag, body: unknown): boolean {
  const prefer = headers.get("prefer") ?? "";
  const token = prefer
    .split(",")
    .map((p) => p.split(";")[0].trim().toLowerCase())
    .includes(RESPOND_ASYNC);
  if (token) return true;
  return typeof body === "object" && body !== null && (body as { async?: unknown }).async === true;
}

/** Client backoff: start at the server's pollAfterMs, grow 1.5x per poll up
 * to 5 s while the server answers; after errors (offline, 5xx) double up to
 * 15 s. A larger server hint (pollAfterMs, Retry-After) always wins. */
export const POLL_POLICY = {
  firstMs: POLL_AFTER_MS,
  factor: 1.5,
  maxMs: 5000,
  errorMaxMs: 15_000,
  /** Give up after this long. The server fails a verdict still judging
   * after 10 minutes, so a client normally hears "failed" first. */
  deadlineMs: 11 * 60_000,
  /** One poll (request and body) that takes longer is dropped and counted
   * as a network error, so a dead connection cannot stall polling. */
  requestTimeoutMs: 20_000,
} as const;

/** Milliseconds to wait before poll number `attempt` (0-based) after
 * `errors` failed polls in a row. Capped at 60 s. */
export function nextPollDelay(attempt: number, opts: { hintMs?: number; errors?: number } = {}): number {
  const { firstMs, factor, maxMs, errorMaxMs } = POLL_POLICY;
  const steady = Math.min(maxMs, firstMs * factor ** Math.max(0, attempt));
  const errors = Math.max(0, opts.errors ?? 0);
  const backoff = errors > 0 ? Math.min(errorMaxMs, firstMs * 2 ** errors) : 0;
  const hint = opts.hintMs && Number.isFinite(opts.hintMs) ? opts.hintMs : 0;
  return Math.round(Math.min(60_000, Math.max(steady, backoff, hint)));
}

export type PollOutcome =
  | { kind: "ready"; body: ReadyPollResponse }
  /** `code`: a VerdictJobErrorCode, or `removed` (410) / `not_found` (404). */
  | { kind: "failed"; code: string; status: number; body: unknown }
  | { kind: "timeout" }
  | { kind: "aborted" };

type PollResponse = { status: number; headers: HeaderBag; json(): Promise<unknown> };

/** An AbortSignal, or any object with `aborted` (checked between polls). */
export type PollSignal = {
  readonly aborted: boolean;
  addEventListener?(type: "abort", listener: () => void): void;
  removeEventListener?(type: "abort", listener: () => void): void;
};

export type PollDeps = {
  /** `init.signal` aborts on the per-poll timeout or the caller's signal;
   * pass it to the real fetch. */
  fetch: (
    url: string,
    init: { headers: Record<string, string>; cache?: "no-store"; signal?: AbortSignal },
  ) => Promise<PollResponse>;
  /** Waits `ms`; the website also wakes it early when the tab is shown again. */
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
  /** Prefix for the poll path (the website uses "", the app its base URL). */
  baseUrl?: string;
  /** Sent as X-Owner-Token so a ready answer carries `owner`. */
  ownerToken?: string | null;
  /** Extra headers, e.g. Authorization for the app. */
  headers?: Record<string, string>;
  /** The first wait (the 202's pollAfterMs). */
  firstDelayMs?: number;
  deadlineMs?: number;
  /** Limit for one poll; defaults to POLL_POLICY.requestTimeoutMs. */
  requestTimeoutMs?: number;
  /** Checked before and after every poll. A real AbortSignal also cancels
   * the poll in flight. */
  signal?: PollSignal;
};

function retryAfterMs(headers: HeaderBag): number | undefined {
  const raw = headers.get("retry-after");
  const sec = raw ? Number(raw) : NaN;
  return Number.isFinite(sec) && sec >= 0 ? sec * 1000 : undefined;
}

type PollAnswer = { res: PollResponse; body: unknown };

/** One poll, request and body, bounded by `ms` and the caller's signal.
 * Rejects on a timeout or abort even when the fetch ignores its signal. */
async function timedPoll(
  deps: PollDeps,
  url: string,
  headers: Record<string, string>,
  ms: number,
): Promise<PollAnswer> {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stop = new Promise<never>((_, reject) => {
    const fail = () => {
      ctl?.abort();
      reject(new Error("poll timed out or aborted"));
    };
    timer = setTimeout(fail, ms);
    onAbort = fail;
    deps.signal?.addEventListener?.("abort", onAbort);
  });
  const run = (async (): Promise<PollAnswer> => {
    const res = await deps.fetch(url, { headers, cache: "no-store", ...(ctl ? { signal: ctl.signal } : {}) });
    const body: unknown = await res.json().catch(() => null);
    return { res, body };
  })();
  try {
    return await Promise.race([run, stop]);
  } finally {
    clearTimeout(timer);
    if (onAbort) deps.signal?.removeEventListener?.("abort", onAbort);
    // The losing side's rejection is expected; keep it from going unhandled.
    run.catch(() => {});
    stop.catch(() => {});
  }
}

/**
 * Polls GET {baseUrl}/api/v1/verdicts/{id} until the verdict is ready or
 * failed. Network errors, polls slower than requestTimeoutMs and 5xx/429
 * answers keep polling (with backoff); only a ready, failed, 404 or 410
 * answer, the deadline or the signal ends it. Never throws.
 */
export async function pollVerdict(id: string, deps: PollDeps): Promise<PollOutcome> {
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.deadlineMs ?? POLL_POLICY.deadlineMs);
  const url = `${deps.baseUrl ?? ""}/api/v1/verdicts/${encodeURIComponent(id)}`;
  const headers: Record<string, string> = { Accept: "application/json", ...deps.headers };
  if (deps.ownerToken) headers["X-Owner-Token"] = deps.ownerToken;

  let attempt = 0;
  let errors = 0;
  let wait = deps.firstDelayMs ?? POLL_POLICY.firstMs;
  for (;;) {
    await deps.sleep(Math.max(0, Math.min(wait, deadline - now())));
    if (deps.signal?.aborted) return { kind: "aborted" };
    if (now() >= deadline) return { kind: "timeout" };

    let res: PollResponse;
    let body: unknown;
    try {
      const limit = Math.min(deps.requestTimeoutMs ?? POLL_POLICY.requestTimeoutMs, deadline - now());
      ({ res, body } = await timedPoll(deps, url, headers, Math.max(1, limit)));
    } catch {
      if (deps.signal?.aborted) return { kind: "aborted" };
      errors += 1;
      wait = nextPollDelay(attempt, { errors });
      continue;
    }
    if (deps.signal?.aborted) return { kind: "aborted" };
    const b = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;

    if (res.status === 200 && b) {
      if (b.status === "judging") {
        errors = 0;
        attempt += 1;
        const hint = typeof b.pollAfterMs === "number" ? b.pollAfterMs : retryAfterMs(res.headers);
        wait = nextPollDelay(attempt, { hintMs: hint });
        continue;
      }
      if (b.status === "failed") {
        return { kind: "failed", code: typeof b.code === "string" ? b.code : "unavailable", status: 200, body };
      }
      // "ready", or a server from before async verdicts (no status field).
      if (b.result && typeof b.id === "string") return { kind: "ready", body: { ...(b as ReadyPollResponse), status: "ready" } };
    }
    if (res.status === 404 || res.status === 410) {
      const code = b && typeof b.code === "string" ? b.code : res.status === 410 ? "removed" : "not_found";
      return { kind: "failed", code, status: res.status, body };
    }
    // 429, 5xx, a proxy error page or an unreadable body: keep polling.
    errors += 1;
    wait = nextPollDelay(attempt, { errors, hintMs: retryAfterMs(res.headers) });
  }
}
