import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { DYNAMIC_ROUTES, scrubBreadcrumb, scrubEvent, scrubPath } from "../lib/sentry";

/** Route paths down to each [param] folder under app/. */
function dynamicRoutes(dir = "app", route = ""): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      // Route groups and parallel routes add no path segment.
      const segment = /^\(.*\)$|^@/.test(d.name) ? "" : `/${d.name}`;
      if (d.name.startsWith("[")) return [route + segment];
      return dynamicRoutes(join(dir, d.name), route + segment);
    });
}

describe("DYNAMIC_ROUTES", () => {
  it("lists every route with a [param] folder", () => {
    expect([...DYNAMIC_ROUTES].sort()).toEqual(dynamicRoutes().sort());
  });
});

describe("scrubPath", () => {
  it("replaces ids and tokens with the parameter name", () => {
    expect(scrubPath("/r/tok_SECRET")).toBe("/r/:token");
    expect(scrubPath("/v/abc123/opengraph-image")).toBe("/v/:id/opengraph-image");
    expect(scrubPath("/api/v1/respond/tok_SECRET/evidence?x=1")).toBe("/api/v1/respond/:token/evidence");
    expect(scrubPath("/api/v1/cases/c1/judge")).toBe("/api/v1/cases/:id/judge");
    expect(scrubPath("/api/auth/reset-password/tok_SECRET")).toBe("/api/auth/:all");
    expect(scrubPath("/api/verdict")).toBe("/api/verdict");
    expect(scrubPath("/verdicts")).toBe("/verdicts");
  });

  it("leaves route templates readable", () => {
    expect(scrubPath("/r/[token]")).toBe("/r/:token");
  });
});

describe("scrubEvent", () => {
  it("keeps the url path and method, drops everything else from the request", () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: "https://okjudge.com/api/verdict?draft=my%20side#top",
        method: "POST",
        data: { text: "my side of the story" },
        query_string: "draft=my%20side",
        cookies: { session: "abc" },
        headers: { "user-agent": "Mozilla/5.0", cookie: "session=abc" },
        env: { REMOTE_ADDR: "203.0.113.5" },
      },
    } as ErrorEvent);
    expect(event.request).toEqual({ url: "https://okjudge.com/api/verdict", method: "POST" });
  });

  it("drops the user and extra, keeps the stack, release and environment", () => {
    const exception = { values: [{ type: "Error", value: "boom", stacktrace: { frames: [{ filename: "app.js" }] } }] };
    const event = scrubEvent({
      type: undefined,
      user: { id: "u1", ip_address: "203.0.113.5" },
      extra: { body: "case text" },
      exception,
      release: "abc123",
      environment: "production",
    } as ErrorEvent);
    expect(event.user).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.exception).toEqual(exception);
    expect(event.release).toBe("abc123");
    expect(event.environment).toBe("production");
  });

  it("strips the query from the Next.js request path", () => {
    const event = scrubEvent({
      type: undefined,
      contexts: { nextjs: { request_path: "/about?name=Sam", route_type: "render" } },
    } as ErrorEvent);
    expect(event.contexts?.nextjs).toEqual({ request_path: "/about", route_type: "render" });
  });

  it("scrubs breadcrumbs already on the event", () => {
    const event = scrubEvent({
      type: undefined,
      breadcrumbs: [
        { category: "console", message: "draft: my side of the story" },
        { category: "fetch", data: { method: "GET", url: "/api/me?x=1", status_code: 200 } },
      ],
    } as ErrorEvent);
    expect(event.breadcrumbs).toEqual([{ category: "fetch", data: { method: "GET", url: "/api/me", status_code: 200 } }]);
  });
});

describe("path secrets", () => {
  it("are scrubbed from the request url", () => {
    const browser = scrubEvent({ type: undefined, request: { url: "https://okjudge.com/r/tok_SECRET?a=1" } } as ErrorEvent);
    expect(browser.request?.url).toBe("https://okjudge.com/r/:token");
    const server = scrubEvent({
      type: undefined,
      request: { url: "http://127.0.0.1:3000/api/v1/respond/tok_SECRET", method: "POST" },
    } as ErrorEvent);
    expect(server.request?.url).toBe("http://127.0.0.1:3000/api/v1/respond/:token");
  });

  it("are scrubbed from the transaction name", () => {
    const tx = (transaction: string) => scrubEvent({ type: undefined, transaction } as ErrorEvent).transaction;
    expect(tx("POST /api/v1/respond/tok_SECRET")).toBe("POST /api/v1/respond/:token");
    expect(tx("GET /r/tok_SECRET?a=1")).toBe("GET /r/:token");
    expect(tx("/c/c1")).toBe("/c/:id");
    expect(tx("POST /api/v1/respond/[token]")).toBe("POST /api/v1/respond/:token");
  });

  it("are scrubbed from the Next.js request path", () => {
    const event = scrubEvent({
      type: undefined,
      contexts: { nextjs: { request_path: "/api/v1/verdicts/v1/mine", router_path: "/api/v1/verdicts/[id]/mine" } },
    } as ErrorEvent);
    expect(event.contexts?.nextjs?.request_path).toBe("/api/v1/verdicts/:id/mine");
  });

  it("are scrubbed from fetch and navigation breadcrumbs", () => {
    expect(scrubBreadcrumb({ category: "fetch", data: { method: "GET", url: "/api/v1/respond/tok_SECRET" } })?.data).toEqual({
      method: "GET",
      url: "/api/v1/respond/:token",
    });
    expect(scrubBreadcrumb({ category: "navigation", data: { from: "/", to: "/r/tok_SECRET" } })?.data).toEqual({
      from: "/",
      to: "/r/:token",
    });
  });

  it("leave only the origin of requests to other sites", () => {
    expect(
      scrubBreadcrumb({ category: "http", data: { url: "https://api.revenuecat.com/v1/subscribers/user_SECRET", status_code: 200 } })
        ?.data,
    ).toEqual({ url: "https://api.revenuecat.com", status_code: 200 });
  });
});

describe("scrubBreadcrumb", () => {
  it("drops console breadcrumbs", () => {
    expect(scrubBreadcrumb({ category: "console", message: "hi", data: { arguments: ["hi"] } })).toBeNull();
  });

  it("keeps only method, status and query-free urls", () => {
    expect(
      scrubBreadcrumb({
        category: "xhr",
        data: { method: "POST", url: "/api/verdict?lang=en", status_code: 500, request_body_size: 1200, body: "x" },
      }),
    ).toEqual({ category: "xhr", data: { method: "POST", url: "/api/verdict", status_code: 500 } });
    expect(scrubBreadcrumb({ category: "navigation", data: { from: "/?q=a", to: "/v/abc#share" } })).toEqual({
      category: "navigation",
      data: { from: "/", to: "/v/:id" },
    });
  });

  it("leaves breadcrumbs without data alone", () => {
    expect(scrubBreadcrumb({ category: "sentry.event", message: "Error: boom" })).toEqual({
      category: "sentry.event",
      message: "Error: boom",
    });
  });
});
