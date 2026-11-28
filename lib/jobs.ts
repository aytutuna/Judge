/**
 * Work that runs after a response. On Node it runs in the process (Next's
 * after()), as before. On Workers a request may only keep running 30 seconds
 * after it answers, and judging takes minutes, so the job is handed to a
 * JobRunner Durable Object, whose alarm calls back into the app
 * (POST /api/internal/job, secured by JOB_SECRET) with the job's name and
 * arguments. Arguments are plain JSON and only held in memory: a job lost to
 * an eviction is failed and refunded by the stale-job sweep, as after a kill.
 */

import { workerEnv } from "./worker-env";

export type JobSpec = { name: JobName; args: unknown[] };

const RUN = {
  premium: async (a: unknown[]) => (await import("./premium/async")).runPremiumJob(a[0] as never),
  caseJudging: async (a: unknown[]) => (await import("./cases/judging")).runCaseJudging(...(a as Parameters<typeof import("./cases/judging").runCaseJudging>)),
  appealJudging: async (a: unknown[]) => (await import("./cases/judging")).runAppealJudging(...(a as Parameters<typeof import("./cases/judging").runAppealJudging>)),
  ownerNotice: async (a: unknown[]) => (await import("./cases/notify")).notifyOwnerSideWaiting(...(a as Parameters<typeof import("./cases/notify").notifyOwnerSideWaiting>)),
  verdictAppeal: async (a: unknown[]) => (await import("./verdict-appeals/service")).runVerdictAppeal(a[0] as never),
} satisfies Record<string, (args: unknown[]) => Promise<void>>;

export type JobName = keyof typeof RUN;

export const isJobName = (name: unknown): name is JobName => typeof name === "string" && Object.hasOwn(RUN, name);

export function runJob(spec: JobSpec): Promise<void> {
  return RUN[spec.name](spec.args);
}

/** What to run after the response: the closure on Node, the hand-off to the
 * JobRunner on Workers (when the call site named the job). */
export function backgroundWork(fn: () => Promise<void>, job?: JobSpec): () => Promise<void> {
  const runners = workerEnv()?.JOBS;
  if (!runners || !job) return fn;
  return async () => {
    await runners.get(runners.idFromName(crypto.randomUUID())).enqueue(job);
  };
}
