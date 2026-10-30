import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, resetAnalytics, setAnalytics, signInCompleted, signInStarted, track } from "@/lib/analytics/client";

const beacon = vi.fn<(url: string, body: Blob) => boolean>(() => true);

// The suite runs in node: stand in for the few browser globals the client reads.
const listeners = new Map<string, () => void>();
const doc = {
  documentElement: { lang: "tr" },
  visibilityState: "visible",
  addEventListener: (type: string, fn: () => void) => listeners.set(`doc:${type}`, fn),
  removeEventListener: (type: string) => listeners.delete(`doc:${type}`),
  dispatch: (type: string) => listeners.get(`doc:${type}`)?.(),
};
const store = new Map<string, string>();
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

function setNav(nav: Record<string, unknown>) {
  vi.stubGlobal("navigator", { sendBeacon: beacon, doNotTrack: null, ...nav });
}

async function sent(call = 0): Promise<{ context: Record<string, unknown>; events: { name: string; props?: unknown }[] }> {
  const blob = beacon.mock.calls[call][1] as Blob;
  expect(blob.type).toBe("application/json");
  return JSON.parse(await blob.text());
}

beforeEach(() => {
  vi.useFakeTimers();
  beacon.mockClear();
  setNav({});
  doc.documentElement.lang = "tr";
  doc.visibilityState = "visible";
  store.clear();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", { addEventListener: (t: string, f: () => void) => listeners.set(`win:${t}`, f), removeEventListener: (t: string) => listeners.delete(`win:${t}`) });
  vi.stubGlobal("sessionStorage", storage);
  resetAnalytics();
});

afterEach(() => {
  resetAnalytics();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("web usage events", () => {
  it("holds events until the config is known, then flushes at 20", () => {
    for (let i = 0; i < 25; i++) track("case_started");
    expect(beacon).not.toHaveBeenCalled();
    setAnalytics(true);
    expect(beacon).toHaveBeenCalledTimes(1);
    track("case_started");
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("sends the web context without any identifier", async () => {
    setAnalytics(true);
    track("screen_view", { screen: "home" });
    flush();
    const body = await sent();
    expect(body.context).toEqual({ platform: "web", app_version: expect.any(String), locale: "tr" });
    expect(body.events[0]).toMatchObject({ name: "screen_view", props: { screen: "home" } });
    expect(store.size).toBe(0);
  });

  it("flushes every 30 seconds", () => {
    setAnalytics(true);
    track("app_open");
    vi.advanceTimersByTime(30_000);
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("flushes when the page is hidden", () => {
    setAnalytics(true);
    track("app_open");
    doc.visibilityState = "hidden";
    doc.dispatch("visibilitychange");
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("falls back to fetch keepalive without sendBeacon", () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);
    setNav({ sendBeacon: undefined });
    setAnalytics(true);
    track("app_open");
    flush();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/events", expect.objectContaining({ keepalive: true, method: "POST" }));
  });

  it("splits batches at 50 and keeps at most 200 queued", async () => {
    for (let i = 0; i < 230; i++) track("app_open");
    setAnalytics(true);
    flush();
    const sizes = [];
    for (let i = 0; i < beacon.mock.calls.length; i++) sizes.push((await sent(i)).events.length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(200);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(50);
  });

  it.each([{ doNotTrack: "1" }, { globalPrivacyControl: true }])("sends nothing when %o", (signal) => {
    setNav(signal);
    setAnalytics(true);
    track("app_open");
    flush();
    expect(beacon).not.toHaveBeenCalled();
  });

  it("drops everything when the deployment turns analytics off", () => {
    track("app_open");
    setAnalytics(false);
    track("app_open");
    flush();
    expect(beacon).not.toHaveBeenCalled();
  });

  it("refuses unknown events and props outside the allowlist", async () => {
    setAnalytics(true);
    track("not_an_event");
    track("app_open", { screen: "home" });
    track("screen_view", { screen: "has space" });
    track("screen_view", { text: "hello" });
    track("buy_tapped", { product: "pack_10" });
    flush();
    const body = await sent();
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ name: "buy_tapped", props: { product: "pack_10" } });
  });

  it("reports sign_in_completed only after sign_in_started in this tab", async () => {
    setAnalytics(true);
    signInCompleted();
    signInStarted("google");
    signInCompleted();
    signInCompleted();
    flush();
    const names = (await sent()).events.map((e) => e.name);
    expect(names).toEqual(["sign_in_started", "sign_in_completed"]);
  });
});
