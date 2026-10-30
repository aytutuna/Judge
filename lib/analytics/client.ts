/**
 * Browser side of the usage events (POST /api/v1/events, see ./track.ts).
 * The website keeps no identifier: no anon_id, no device_id, nothing in
 * storage. Events are linked to an account only through the session cookie
 * the browser sends anyway. The only thing kept in sessionStorage is a
 * couple of per-tab flags.
 */

// Set from package.json in next.config.ts.
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0";
const ENDPOINT = "/api/v1/events";
const FLUSH_AT = 20;
const FLUSH_EVERY_MS = 30_000;
const MAX_QUEUE = 200;
const MAX_BATCH = 50;

// Copy of CLIENT_EVENTS and EVENT_PROPS in ./validate.ts, which pulls in zod
// and Buffer and so stays out of the browser bundle. Keep in step.
const EVENTS = new Set([
  "app_open",
  "screen_view",
  "case_started",
  "case_submitted",
  "evidence_added",
  "question_answered",
  "verdict_viewed",
  "share_tapped",
  "buy_tapped",
  "purchase_completed",
  "sign_in_started",
  "sign_in_completed",
  "settings_changed",
  "error_shown",
]);
const PROP_KEYS: Record<string, string> = {
  screen_view: "screen",
  buy_tapped: "product",
  sign_in_started: "provider",
  settings_changed: "key",
  error_shown: "code",
};
const TOKEN = /^[A-Za-z0-9_.:/-]{1,64}$/;

export type EventProps = Record<string, string | number | boolean>;
type Queued = { name: string; at: number; props?: EventProps };

let queue: Queued[] = [];
let enabled: boolean | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let listening = false;

function optedOut(): boolean {
  if (typeof navigator === "undefined") return true;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

function propsOk(name: string, props: EventProps): boolean {
  return Object.entries(props).every(([key, value]) => {
    if (PROP_KEYS[name] !== key) return false;
    return typeof value === "string" ? TOKEN.test(value) : typeof value === "boolean" || Number.isInteger(value);
  });
}

/** Set from `features.analytics` once the site config is known. Until then
 * events wait in the queue; when off, they are dropped. */
export function setAnalytics(on: boolean): void {
  enabled = on;
  if (!on) {
    queue = [];
    stop();
    return;
  }
  if (queue.length >= FLUSH_AT) flush();
}

/** False once analytics is known to be off or the visitor opted out. */
export function isTracking(): boolean {
  return enabled !== false && !optedOut();
}

export function track(name: string, props?: EventProps): void {
  try {
    if (!isTracking() || !EVENTS.has(name)) return;
    if (props && !propsOk(name, props)) return;
    if (queue.length >= MAX_QUEUE) queue.shift();
    queue.push({ name, at: Date.now(), ...(props ? { props } : {}) });
    start();
    if (enabled && queue.length >= FLUSH_AT) flush();
  } catch {
    // Usage events never break the page.
  }
}

export function flush(): void {
  try {
    sendQueued();
  } catch {
    // Same: a failed send is lost, not thrown.
  }
}

function sendQueued(): void {
  if (!enabled || queue.length === 0) return;
  const locale = document.documentElement.lang;
  while (queue.length > 0) {
    const events = queue.splice(0, MAX_BATCH);
    const body = JSON.stringify({
      context: { platform: "web", app_version: APP_VERSION, ...(locale ? { locale } : {}) },
      events,
    });
    send(body);
  }
}

function send(body: string): void {
  try {
    const blob = new Blob([body], { type: "application/json" });
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(ENDPOINT, blob)) return;
  } catch {
    // Fall through to fetch.
  }
  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

function onHidden(): void {
  if (document.visibilityState === "hidden") flush();
}

function start(): void {
  if (!timer) timer = setInterval(flush, FLUSH_EVERY_MS);
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", flush);
}

function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (!listening) return;
  listening = false;
  document.removeEventListener("visibilitychange", onHidden);
  window.removeEventListener("pagehide", flush);
}

/** Test hook: forget all state. */
export function resetAnalytics(): void {
  queue = [];
  enabled = null;
  stop();
}

export function trackError(code: string): void {
  track("error_shown", { code });
}

/** error_shown for a failed API answer: its `code`, else http_<status>. */
export function trackApiError(body: unknown, status: number): void {
  const code = typeof body === "object" && body !== null ? (body as { code?: unknown }).code : null;
  trackError(typeof code === "string" ? code : `http_${status}`);
}

const SIGN_IN_FLAG = "sign_in_started";

export function signInStarted(provider: string): void {
  track("sign_in_started", { provider });
  if (!isTracking()) return;
  try {
    sessionStorage.setItem(SIGN_IN_FLAG, "1");
  } catch {
    // Storage blocked: sign_in_completed is just not reported.
  }
}

/** Call once a signed-in user is seen: reports sign_in_completed if this tab
 * started a sign-in. A link opened in another browser is not counted. */
export function signInCompleted(): void {
  try {
    if (!sessionStorage.getItem(SIGN_IN_FLAG)) return;
    sessionStorage.removeItem(SIGN_IN_FLAG);
  } catch {
    return;
  }
  track("sign_in_completed");
}
