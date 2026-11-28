import type { Instrumentation } from "next";
import { workerEnv } from "./lib/worker-env";

/**
 * Runs once when a server instance starts. Async verdicts left judging by a
 * previous process (killed or restarted mid-run) are failed and refunded
 * here once they pass the 10-minute mark, then every few minutes. Usage
 * events past their retention are deleted now and once a day, and so is the
 * text of verdicts and cases removed over 30 days ago (lib/erasure). Expired
 * sign-in codes, old consent records and old removal-log entries go daily too
 * (lib/cleanup). None of that runs on Workers; see lib/cron.ts.
 */
export async function register(): Promise<void> {
  // On Workers there is no long-lived process: Sentry is set up around the
  // fetch handler (cloudflare/worker.ts) and the sweeps are Cron Triggers
  // (lib/cron.ts).
  if (workerEnv()) return;
  // The SDK is only loaded with a DSN; without one it would just cost memory.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SENTRY_DSN) {
    const [Sentry, { sentryOptions, withoutConsole }] = await Promise.all([
      import("@sentry/nextjs"),
      import("./lib/sentry"),
    ]);
    Sentry.init({ dsn: process.env.SENTRY_DSN, ...sentryOptions, integrations: withoutConsole });
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    // systemd sets JOURNAL_STREAM when stderr goes to the journal.
    if (process.env.JOURNAL_STREAM) {
      const { tagJournalLevels } = await import("./lib/journal");
      tagJournalLevels();
    }
    const { startVerdictJobSweeper } = await import("./lib/verdict-jobs");
    startVerdictJobSweeper();
    const { startEventPruner } = await import("./lib/analytics/db");
    startEventPruner();
    const { startErasureSweeper } = await import("./lib/erasure");
    startErasureSweeper();
    const { startCleanup } = await import("./lib/cleanup");
    startCleanup();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.SENTRY_DSN) return;
  if (workerEnv()) {
    const { captureException } = await import("@sentry/cloudflare");
    captureException(args[0]);
    return;
  }
  const { captureRequestError } = await import("@sentry/nextjs");
  captureRequestError(...args);
};
