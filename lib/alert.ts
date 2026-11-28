/**
 * On Workers there is no log watcher (deploy/aws-lightsail/watch.sh), so the
 * lines it counted, `[alert:...]` and `[signal:...]`, also go to Sentry, where
 * alert rules email them. Nothing happens on Node. At most one event per kind
 * and name a minute per isolate, so a flood of rate-limit signals is one event.
 */

import { workerEnv } from "./worker-env";

const EVERY_MS = 60_000;
const last = new Map<string, number>();
let sentry: Promise<typeof import("@sentry/cloudflare")> | undefined;

export function alertSentry(kind: "alert" | "signal", name: string, detail?: string, now: number = Date.now()): void {
  if (!workerEnv() || !process.env.SENTRY_DSN) return;
  const key = `${kind}:${name}`;
  if (now - (last.get(key) ?? -Infinity) < EVERY_MS) return;
  last.set(key, now);
  void (sentry ??= import("@sentry/cloudflare"))
    .then((Sentry) =>
      Sentry.captureMessage(`[${key}]${detail ? ` ${detail}` : ""}`, { level: kind === "alert" ? "error" : "warning", fingerprint: [key] }),
    )
    .catch(() => undefined);
}

/** For tests. */
export function forgetAlerts(): void {
  last.clear();
}
