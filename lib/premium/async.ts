/**
 * The async one-sided premium verdict's background run: judge the prepared
 * (already anonymized) submission, then store it with the credit settled in
 * the same guarded batch (consumed; refunded when the panel refused or was
 * degraded), or fail the job with the refund. Rules as in ./handler.ts.
 * The judges see only the prepared text; the text as written is only
 * sealed into the encrypted original at save. Server only.
 */

import type { UsageTotals } from "@/lib/claude";
import type { OriginalPayload } from "@/lib/originals-types";
import type { FrameworkChoice } from "@/lib/types";
import type { Lang } from "@/lib/i18n";
import { completeVerdictJob, failVerdictJob, maybeSweepVerdictJobs } from "@/lib/verdict-jobs";
import { premiumLogLine, runPreparedPipeline, type PreparedPremium, type PremiumRun } from "./run";

export type PremiumJobInput = {
  id: string;
  userId: string;
  reservationId: string;
  prepared: PreparedPremium;
  framework: FrameworkChoice;
  lang: Lang;
  original: OriginalPayload;
  startedAt: number;
  anonymizeUsage?: UsageTotals;
};

/** Never throws: every failure ends as a failed, refunded job (or, if even
 * that write fails, the sweep fails and refunds it later). */
export async function runPremiumJob(job: PremiumJobInput): Promise<void> {
  let run: PremiumRun | undefined;
  try {
    run = await runPreparedPipeline(
      job.prepared,
      { framework: job.framework, lang: job.lang },
      { startedAt: job.startedAt, ...(job.anonymizeUsage ? { anonymizeUsage: job.anonymizeUsage } : {}) },
    );
    const outcome = run.outcome;
    if (outcome.status !== "ok") {
      const code = outcome.status === "failed" ? outcome.code : "unavailable";
      console.error(`[premium] job ${job.id}: all judge runs failed:`, outcome.error);
      await failVerdictJob(job.id, code, job.reservationId);
      console.info(premiumLogLine(null, code, run));
      return;
    }
    // The model declined, or every strong seat failed and the verdict rests
    // on Haiku alone: the user gets the result, not a charge.
    const free = outcome.refused || outcome.degraded;
    const done = await completeVerdictJob(
      {
        id: job.id,
        input: outcome.input,
        framework: job.framework,
        result: outcome.result,
        kind: "premium",
        ownerUserId: job.userId,
        original: job.original,
      },
      { ownerToken: null, reservationId: job.reservationId, settle: free ? "refund" : "consume" },
    );
    if (!done.stored) {
      console.warn(`[premium] job ${job.id} was no longer judging; nothing stored`);
      console.info(premiumLogLine(null, "superseded", run));
      return;
    }
    console.info(premiumLogLine(job.id, outcome.refused ? "refused" : outcome.degraded ? "degraded" : "ok", run));
  } catch (e) {
    console.error(`[premium] job ${job.id} failed:`, e instanceof Error ? e.message : String(e));
    if (run) console.info(premiumLogLine(null, "error", run));
    await failVerdictJob(job.id, "unavailable", job.reservationId).catch((err: unknown) => {
      console.error(`[premium] job ${job.id}: marking failed did not work:`, err instanceof Error ? err.message : String(err));
    });
  } finally {
    await maybeSweepVerdictJobs();
  }
}
