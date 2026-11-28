import { AsyncLocalStorage } from "node:async_hooks";
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

type Waiter = { waitUntil(promise: Promise<unknown>): void };
const requestContext = new AsyncLocalStorage<Waiter>();

/** Runs one request's code with its execution context, so keepAlive can find it. */
export function runWithContext<T>(ctx: Waiter, fn: () => T): T {
  return requestContext.run(ctx, fn);
}

/** Lets work that nobody awaits (usage events, a sweep) finish after the
 * response: a Worker may be stopped once its response is sent. Does nothing
 * on Node, where the process keeps running. */
export function keepAlive(work: Promise<unknown>): void {
  requestContext.getStore()?.waitUntil(work);
}
