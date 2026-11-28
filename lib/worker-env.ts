import type { WorkerEnv } from "../cloudflare/env";

const KEY = Symbol.for("judge.workerEnv");

/** Called by every Workers entry point (fetch, scheduled, Durable Objects)
 * before app code runs. The bindings never change within an isolate. */
export function setWorkerEnv(env: WorkerEnv): void {
  (globalThis as Record<symbol, unknown>)[KEY] = env;
}

/** The bindings, or undefined when running on Node (next start, scripts, tests). */
export function workerEnv(): WorkerEnv | undefined {
  return (globalThis as Record<symbol, unknown>)[KEY] as WorkerEnv | undefined;
}
