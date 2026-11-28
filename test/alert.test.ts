import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "../cloudflare/env";
import { setWorkerEnv } from "../lib/worker-env";

const captured: { message: string; context: unknown }[] = [];
vi.mock("@sentry/cloudflare", () => ({
  captureMessage: (message: string, context: unknown) => void captured.push({ message, context }),
}));
const { alertSentry, forgetAlerts } = await import("../lib/alert");
const { signal } = await import("../lib/signals");

const flush = () => new Promise((r) => setTimeout(r, 100));

beforeEach(() => {
  captured.length = 0;
  forgetAlerts();
  process.env.SENTRY_DSN = "https://key@example.test/1";
});
afterEach(() => {
  setWorkerEnv(undefined as unknown as WorkerEnv);
  delete process.env.SENTRY_DSN;
});

describe("alertSentry", () => {
  it("sends nothing on Node", async () => {
    signal("webhook_bad_secret");
    await flush();
    expect(captured).toEqual([]);
  });

  it("sends a signal and an alert on Workers, grouped by kind and name", async () => {
    setWorkerEnv({} as WorkerEnv);
    signal("webhook_bad_secret", "bucket=x");
    alertSentry("alert", "backup", "no copy");
    await flush();
    expect(captured.map((c) => c.message)).toEqual(["[signal:webhook_bad_secret] bucket=x", "[alert:backup] no copy"]);
    expect(captured[1].context).toMatchObject({ level: "error", fingerprint: ["alert:backup"] });
  });

  it("sends one event a minute for a flood of the same signal", async () => {
    setWorkerEnv({} as WorkerEnv);
    for (let i = 0; i < 20; i++) alertSentry("signal", "rate_limited", undefined, 1_000 + i);
    alertSentry("signal", "rate_limited", undefined, 62_000);
    await flush();
    expect(captured).toHaveLength(2);
  });

  it("sends nothing without a DSN", async () => {
    setWorkerEnv({} as WorkerEnv);
    delete process.env.SENTRY_DSN;
    alertSentry("alert", "backup");
    await flush();
    expect(captured).toEqual([]);
  });
});
