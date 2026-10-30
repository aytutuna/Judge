import type { BrowserOptions, Breadcrumb, ErrorEvent, NodeOptions } from "@sentry/nextjs";

/**
 * Error reporting setup shared by the browser (instrumentation-client.ts) and
 * the server (instrumentation.ts). Reports keep the stack trace, URL path,
 * release and environment, and nothing a visitor typed or sent: no request
 * bodies, headers, cookies, query strings, local variables or user. Ids and
 * tokens in paths are replaced with the route's parameter name.
 */

// The app's routes with a [param] folder (test/sentry.test.ts checks this
// against app/). A /r/<token> link alone opens a case.
export const DYNAMIC_ROUTES = [
  "/api/auth/[...all]",
  "/api/v1/cases/[id]",
  "/api/v1/respond/[token]",
  "/api/v1/verdicts/[id]",
  "/api/verdict/[id]",
  "/c/[id]",
  "/r/[token]",
  "/v/[id]",
];

const PATTERNS = DYNAMIC_ROUTES.map((route) => {
  const parts = route.split("/").slice(1);
  const source = parts.map((p) => (p.startsWith("[...") ? ".+" : p.startsWith("[") ? "[^/]+" : p)).join("/");
  return {
    re: new RegExp(`^/${source}(?=/|$)`),
    to: "/" + parts.map((p) => p.replace(/^\[(?:\.\.\.)?(\w+)\]$/, ":$1")).join("/"),
  };
});

const ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

/** Path without query or fragment, its dynamic segments as :param. */
export function scrubPath(path: string): string {
  const bare = path.replace(/[?#].*$/, "");
  const match = PATTERNS.find((p) => p.re.test(bare));
  return match ? bare.replace(match.re, match.to) : bare;
}

/** A URL of this site: origin kept, path scrubbed. */
export function scrubUrl(url: string): string {
  const origin = ORIGIN.exec(url)?.[0] ?? "";
  return origin + scrubPath(url.slice(origin.length));
}

// Requests to other sites (on the server, every absolute URL is one) keep only
// their origin: their paths can name our users too.
function scrubRequestUrl(url: string): string {
  const origin = ORIGIN.exec(url)?.[0];
  if (origin && origin !== (typeof location === "undefined" ? undefined : location.origin)) return origin;
  return scrubUrl(url);
}

const BREADCRUMB_KEYS = ["method", "http.method", "status_code", "url", "from", "to"];

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category === "console") return null;
  if (crumb.data) {
    const data: Record<string, unknown> = {};
    for (const key of BREADCRUMB_KEYS) {
      const value = crumb.data[key];
      if (value === undefined) continue;
      data[key] = typeof value === "string" && (key === "url" || key === "from" || key === "to") ? scrubRequestUrl(value) : value;
    }
    crumb.data = data;
  }
  return crumb;
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.extra;
  if (event.request) {
    const { url, method } = event.request;
    event.request = {};
    if (url) event.request.url = scrubUrl(url);
    if (method) event.request.method = method;
  }
  // The server names the transaction "<METHOD> <raw path>".
  if (event.transaction) event.transaction = event.transaction.replace(/(^|\s)(\/\S*)$/, (_, s, p) => s + scrubPath(p));
  // captureRequestError puts the raw request path here.
  const nextjs = event.contexts?.nextjs;
  if (nextjs && typeof nextjs.request_path === "string") nextjs.request_path = scrubPath(nextjs.request_path);
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  }
  return event;
}

// Console output can quote case text.
export const withoutConsole = <T extends { name: string }>(integrations: T[]) => integrations.filter((i) => i.name !== "Console");

export const sentryOptions = {
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    stackFrameVariables: false,
  },
  // No sentry-trace or baggage headers on our own or outside requests.
  tracePropagationTargets: [],
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
} satisfies BrowserOptions & NodeOptions;
